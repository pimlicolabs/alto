import { Redis } from "ioredis"
import type { Address, Hex } from "viem"
import type { AltoConfig } from "../createConfig"
import type { UserOperation } from "../types/schemas"
import { getUserOpHash, isDeployment } from "../utils/userop"

interface Entry {
    sender: Address
    nonce: bigint
    isDeployment: boolean // Whether this op deploys the account
}

export interface ProcessingStore {
    startProcessing(userOp: UserOperation): Promise<void>
    finishProcessing(userOpHash: Hex): Promise<void>
    isProcessing(userOpHash: Hex): Promise<boolean>
    findConflict(userOp: UserOperation): Promise<
        | {
              conflictingHash?: Hex
              reason?: "nonce_conflict" | "deployment_conflict"
          }
        | undefined
    >
    clear(): Promise<void>
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

    async startProcessing(userOp: UserOperation): Promise<void> {
        const userOpHash = await getUserOpHash({
            userOp,
            entryPointAddress: this.entryPoint,
            chainId: this.config.chainId,
            publicClient: this.config.publicClient
        })

        const entry: Entry = {
            sender: userOp.sender,
            nonce: userOp.nonce,
            isDeployment: isDeployment(userOp)
        }
        this.trackedOps.set(userOpHash, entry)

        // Track by sender and nonce
        const nonceId = `${entry.sender}:${entry.nonce}`
        this.senderNonces.set(nonceId, userOpHash)

        if (entry.isDeployment) {
            this.deployingSenders.set(entry.sender, userOpHash)
        }
    }

    async finishProcessing(userOpHash: Hex): Promise<void> {
        const entry = this.trackedOps.get(userOpHash)
        if (!entry) return

        const nonceId = `${entry.sender}:${entry.nonce}`
        this.senderNonces.delete(nonceId)

        if (entry.isDeployment) {
            this.deployingSenders.delete(entry.sender)
        }

        this.trackedOps.delete(userOpHash)
    }

    async isProcessing(userOpHash: Hex): Promise<boolean> {
        return this.trackedOps.has(userOpHash)
    }

    async findConflict(userOp: UserOperation): Promise<
        | {
              conflictingHash?: Hex
              reason?: "nonce_conflict" | "deployment_conflict"
          }
        | undefined
    > {
        const isDeploymentCheck = isDeployment(userOp)

        // Deployment conflict: if this is deployment AND sender already deploying
        if (isDeploymentCheck && this.deployingSenders.has(userOp.sender)) {
            return {
                conflictingHash: this.deployingSenders.get(userOp.sender),
                reason: "deployment_conflict"
            }
        }

        // Nonce conflict check
        const nonceId = `${userOp.sender}:${userOp.nonce}`

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
    private noncesKey: string // hash: "sender:nonce" -> userOpHash
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

        const redisPrefix = `${config.redisKeyPrefix}:${config.chainId}:${entryPoint}:conflict`
        this.opsKey = `${redisPrefix}:ops`
        this.noncesKey = `${redisPrefix}:nonces`
        this.deployingKey = `${redisPrefix}:deploying`
    }

    async startProcessing(userOp: UserOperation): Promise<void> {
        const userOpHash = await getUserOpHash({
            userOp,
            entryPointAddress: this.entryPoint,
            chainId: this.config.chainId,
            publicClient: this.config.publicClient
        })

        const entry: Entry = {
            sender: userOp.sender,
            nonce: userOp.nonce,
            isDeployment: isDeployment(userOp)
        }
        const multi = this.redis.multi()

        // Store op entry
        const serialized = JSON.stringify({
            sender: entry.sender,
            nonce: entry.nonce.toString(),
            isDeployment: entry.isDeployment
        })
        multi.hset(this.opsKey, userOpHash, serialized)
        multi.expire(this.opsKey, this.ttlSeconds)

        // Store nonce lookup
        const nonceId = `${entry.sender}:${entry.nonce}`
        multi.hset(this.noncesKey, nonceId, userOpHash)
        multi.expire(this.noncesKey, this.ttlSeconds)

        // Store deployment lookup if applicable
        if (entry.isDeployment) {
            multi.hset(this.deployingKey, entry.sender, userOpHash)
            multi.expire(this.deployingKey, this.ttlSeconds)
        }

        await multi.exec()
    }

    async finishProcessing(userOpHash: Hex): Promise<void> {
        // First get the entry to know what to delete
        const entryStr = await this.redis.hget(this.opsKey, userOpHash)
        if (!entryStr) return

        const entry = JSON.parse(entryStr)
        const multi = this.redis.multi()

        // Remove op entry
        multi.hdel(this.opsKey, userOpHash)

        // Remove nonce lookup
        const nonceId = `${entry.sender}:${entry.nonce}`
        multi.hdel(this.noncesKey, nonceId)

        // Remove deployment lookup if applicable
        if (entry.isDeployment) {
            multi.hdel(this.deployingKey, entry.sender)
        }

        await multi.exec()
    }

    async isProcessing(userOpHash: Hex): Promise<boolean> {
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
        const nonceId = `${userOp.sender}:${userOp.nonce}`
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
