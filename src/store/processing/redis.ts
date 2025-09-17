import type { ProcessingStore } from "@alto/store"
import type { UserOperation } from "@alto/types"
import { getUserOpHash, isDeployment } from "@alto/utils"
import { Redis } from "ioredis"
import type { Address, Hex } from "viem"
import type { AltoConfig } from "../../createConfig"

interface Entry {
    sender: Address
    nonce: bigint
    isDeployment: boolean // Whether this op deploys the account
}

export class RedisProcessingStore implements ProcessingStore {
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
}
