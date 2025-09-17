import { Redis } from "ioredis"
import type { Address, Hex } from "viem"
import type { AltoConfig } from "../createConfig"
import type { UserOperation } from "../types/schemas"
import {
    getNonceKeyAndSequence,
    getUserOpHash,
    isVersion06,
    isVersion07
} from "../utils/userop"

export interface Entry {
    sender: Address
    nonceKey: bigint // Upper 192 bits of nonce
    nonceSequence: bigint // Lower 64 bits of nonce
    isDeployment: boolean // Whether this op deploys the account
}

export interface ProcessingStore {
    track(userOp: UserOperation): Promise<void>
    untrack(userOpHash: Hex): Promise<void>
    isTracked(userOpHash: Hex): Promise<boolean>
    findConflict(userOp: UserOperation): Promise<
        | {
              conflictingHash?: Hex
              reason?: "nonce_conflict" | "deployment_conflict"
          }
        | undefined
    >
    clear(): Promise<void>
}

// Check if operation is a deployment
export function isDeploymentOp(userOp: UserOperation): boolean {
    if (isVersion06(userOp)) {
        return !!userOp.initCode && userOp.initCode !== "0x"
    }
    if (isVersion07(userOp)) {
        return !!userOp.factory && userOp.factory !== "0x"
    }
    return false
}

class InMemoryProcessingStore implements ProcessingStore {
    private trackedOps = new Map<Hex, Entry>()
    private senderNonces = new Map<string, Hex>()
    private deployingSenders = new Map<Address, Hex>()
    private config: AltoConfig
    private entryPoint: Address

    constructor(config: AltoConfig, entryPoint: Address) {
        this.config = config
        this.entryPoint = entryPoint
    }

    async track(userOp: UserOperation): Promise<void> {
        const userOpHash = await getUserOpHash({
            userOp,
            entryPointAddress: this.entryPoint,
            chainId: this.config.chainId,
            publicClient: this.config.publicClient
        })

        const [nonceKey, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
        const entry: Entry = {
            sender: userOp.sender,
            nonceKey,
            nonceSequence,
            isDeployment: isDeploymentOp(userOp)
        }
        this.trackedOps.set(userOpHash, entry)

        // Track by full nonce (key + sequence)
        const nonceId = `${entry.sender}:${entry.nonceKey}:${entry.nonceSequence}`
        this.senderNonces.set(nonceId, userOpHash)

        if (entry.isDeployment) {
            this.deployingSenders.set(entry.sender, userOpHash)
        }
    }

    async untrack(userOpHash: Hex): Promise<void> {
        const entry = this.trackedOps.get(userOpHash)
        if (!entry) return

        const nonceId = `${entry.sender}:${entry.nonceKey}:${entry.nonceSequence}`
        this.senderNonces.delete(nonceId)

        if (entry.isDeployment) {
            this.deployingSenders.delete(entry.sender)
        }

        this.trackedOps.delete(userOpHash)
    }

    async isTracked(userOpHash: Hex): Promise<boolean> {
        return this.trackedOps.has(userOpHash)
    }

    async findConflict(userOp: UserOperation): Promise<
        | {
              conflictingHash?: Hex
              reason?: "nonce_conflict" | "deployment_conflict"
          }
        | undefined
    > {
        const isDeployment = isDeploymentOp(userOp)

        // Deployment conflict: if this is deployment AND sender already deploying
        if (isDeployment && this.deployingSenders.has(userOp.sender)) {
            return {
                conflictingHash: this.deployingSenders.get(userOp.sender),
                reason: "deployment_conflict"
            }
        }

        // Deployment conflict: any op conflicts with ongoing deployment
        if (this.deployingSenders.has(userOp.sender)) {
            return {
                conflictingHash: this.deployingSenders.get(userOp.sender),
                reason: "deployment_conflict"
            }
        }

        // Nonce conflict check (both v0.6 and v0.7 use same logic)
        const [nonceKey, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
        const nonceId = `${userOp.sender}:${nonceKey}:${nonceSequence}`

        if (this.senderNonces.has(nonceId)) {
            return {
                conflictingHash: this.senderNonces.get(nonceId),
                reason: "nonce_conflict"
            }
        }

        return undefined
    }

    async clear(): Promise<void> {
        this.trackedOps.clear()
        this.senderNonces.clear()
        this.deployingSenders.clear()
    }
}

class RedisProcessingStore implements ProcessingStore {
    private redis: Redis
    private opsKey: string // hash: userOpHash -> entry
    private noncesKey: string // hash: "sender:key:sequence" -> userOpHash
    private deployingKey: string // hash: sender -> userOpHash
    private ttlSeconds = 3600
    private config: AltoConfig
    private entryPoint: Address

    constructor({
        config,
        entryPoint,
        redisEndpoint
    }: {
        config: AltoConfig
        entryPoint: Address
        redisEndpoint: string
    }) {
        this.redis = new Redis(redisEndpoint)
        this.config = config
        this.entryPoint = entryPoint
        const chainId = config.chainId
        const prefix = `${chainId}:conflict`
        this.opsKey = `${prefix}:ops:${entryPoint}`
        this.noncesKey = `${prefix}:nonces:${entryPoint}`
        this.deployingKey = `${prefix}:deploying:${entryPoint}`
    }

    async track(userOp: UserOperation): Promise<void> {
        const userOpHash = await getUserOpHash({
            userOp,
            entryPointAddress: this.entryPoint,
            chainId: this.config.chainId,
            publicClient: this.config.publicClient
        })

        const [nonceKey, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
        const entry: Entry = {
            sender: userOp.sender,
            nonceKey,
            nonceSequence,
            isDeployment: isDeploymentOp(userOp)
        }
        const multi = this.redis.multi()

        // Store op entry
        const serialized = JSON.stringify({
            sender: entry.sender,
            nonceKey: entry.nonceKey.toString(),
            nonceSequence: entry.nonceSequence.toString(),
            isDeployment: entry.isDeployment
        })
        multi.hset(this.opsKey, userOpHash, serialized)
        multi.expire(this.opsKey, this.ttlSeconds)

        // Store nonce lookup
        const nonceId = `${entry.sender}:${entry.nonceKey}:${entry.nonceSequence}`
        multi.hset(this.noncesKey, nonceId, userOpHash)
        multi.expire(this.noncesKey, this.ttlSeconds)

        // Store deployment lookup if applicable
        if (entry.isDeployment) {
            multi.hset(this.deployingKey, entry.sender, userOpHash)
            multi.expire(this.deployingKey, this.ttlSeconds)
        }

        await multi.exec()
    }

    async untrack(userOpHash: Hex): Promise<void> {
        // First get the entry to know what to delete
        const entryStr = await this.redis.hget(this.opsKey, userOpHash)
        if (!entryStr) return

        const entry = JSON.parse(entryStr)
        const multi = this.redis.multi()

        // Remove op entry
        multi.hdel(this.opsKey, userOpHash)

        // Remove nonce lookup
        const nonceId = `${entry.sender}:${entry.nonceKey}:${entry.nonceSequence}`
        multi.hdel(this.noncesKey, nonceId)

        // Remove deployment lookup if applicable
        if (entry.isDeployment) {
            multi.hdel(this.deployingKey, entry.sender)
        }

        await multi.exec()
    }

    async isTracked(userOpHash: Hex): Promise<boolean> {
        const exists = await this.redis.hexists(this.opsKey, userOpHash)
        return exists === 1
    }

    async findConflict(userOp: UserOperation): Promise<
        | {
              conflictingHash?: Hex
              reason?: "nonce_conflict" | "deployment_conflict"
          }
        | undefined
    > {
        // Check for deployment conflicts
        const deployingHash = await this.redis.hget(
            this.deployingKey,
            userOp.sender
        )
        if (deployingHash) {
            return {
                conflictingHash: deployingHash as Hex,
                reason: "deployment_conflict"
            }
        }

        // Check for nonce conflicts
        const [nonceKey, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
        const nonceId = `${userOp.sender}:${nonceKey}:${nonceSequence}`
        const conflictingHash = await this.redis.hget(this.noncesKey, nonceId)

        if (conflictingHash) {
            return {
                conflictingHash: conflictingHash as Hex,
                reason: "nonce_conflict"
            }
        }

        return undefined
    }

    async clear(): Promise<void> {
        const multi = this.redis.multi()
        multi.del(this.opsKey)
        multi.del(this.noncesKey)
        multi.del(this.deployingKey)
        await multi.exec()
    }
}

// Holds all userOps that have been removed from outstanding pool and are being processed.
// UserOps are are removed from this store when they have successfully landed onchain or when they are cancelled.
export function createProcessingStore({
    config,
    entryPoint
}: {
    config: AltoConfig
    entryPoint: Address
}): ProcessingStore {
    if (config.enableHorizontalScaling && config.redisEndpoint) {
        return new RedisProcessingStore({
            config,
            entryPoint,
            redisEndpoint: config.redisEndpoint
        })
    }
    return new InMemoryProcessingStore(config, entryPoint)
}
