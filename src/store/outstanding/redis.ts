import {
    type Address,
    type HexData32,
    type UserOpInfo,
    type UserOperation,
    userOpInfoSchema
} from "@alto/types"
import { getNonceKeyAndSequence, isDeployment } from "@alto/utils"
import { Redis } from "ioredis"
import type { Logger } from "pino"
import { toHex } from "viem/utils"
import type { AltoConfig } from "../../createConfig"
import type { OutstandingStore } from "./types"

const serialize = (userOpInfo: UserOpInfo): string => {
    return JSON.stringify(userOpInfo, (_, value) =>
        typeof value === "bigint" ? toHex(value) : value
    )
}

const deserialize = (data: string): UserOpInfo => {
    const parsed = JSON.parse(data)
    return userOpInfoSchema.parse(parsed)
}

class RedisOutstandingQueue implements OutstandingStore {
    private redis: Redis

    private senderNonceKeyPrefix: string // sender + nonceKey -> userOpHash
    private readyQueue: string // Queue of userOpHashes (sorted by composite of userOp.nonceSeq + userOp.maxFeePerGas)
    private userOpHashMap: string // userOpHash -> boolean
    private deploymentHashMap: string // sender -> deployment userOpHash

    constructor({
        config,
        entryPoint,
        redisEndpoint,
        logger
    }: {
        config: AltoConfig
        entryPoint: Address
        redisEndpoint: string
        logger: Logger
    }) {
        this.redis = new Redis(redisEndpoint, {})

        // Initialize Redis key names
        const redisPrefix = `${config.redisKeyPrefix}:${config.chainId}:${entryPoint}:outstanding`
        this.readyQueue = `${redisPrefix}:ready-queue`
        this.senderNonceKeyPrefix = `${redisPrefix}:sender`
        this.userOpHashMap = `${redisPrefix}:userop-hash`
        this.deploymentHashMap = `${redisPrefix}:deployment-senders`

        logger.info(
            {
                readyQueueKey: this.readyQueue
            },
            "Using redis for outstanding mempool."
        )
    }

    // Returns queue index for this sender + nonceKey.
    getSenderNonceQueue(userOp: UserOperation): string {
        const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
        return `${this.senderNonceKeyPrefix}:${userOp.sender}:${nonceKey}`
    }

    // OutstandingStore methods
    async contains(userOpHash: HexData32): Promise<boolean> {
        const exists = await this.redis.hexists(this.userOpHashMap, userOpHash)
        return exists === 1
    }

    async popConflicting(userOp: UserOperation) {
        const { sender, nonce } = userOp
        const [nonceSeq] = getNonceKeyAndSequence(nonce)

        // Check for conflicting nonce.
        const senderNonceQueue = this.getSenderNonceQueue(userOp)
        const conflictingHashes = await this.redis.zrangebyscore(
            senderNonceQueue,
            Number(nonceSeq),
            Number(nonceSeq)
        )

        if (conflictingHashes.length > 0) {
            const conflictingHash = conflictingHashes[0] as HexData32
            const removedUserOp = await this.remove(conflictingHash)

            if (removedUserOp) {
                return {
                    reason: "conflicting_nonce" as const,
                    userOpInfo: removedUserOp
                }
            }
        }

        // Check for conflicting deployment.
        if (isDeployment(userOp)) {
            const existingDeploymentHash = (await this.redis.hget(
                this.deploymentHashMap,
                sender
            )) as HexData32 | null

            if (existingDeploymentHash) {
                const removedUserOp = await this.remove(existingDeploymentHash)

                if (removedUserOp) {
                    return {
                        reason: "conflicting_deployment" as const,
                        userOpInfo: removedUserOp
                    }
                }
            }
        }

        return undefined
    }

    async add(userOpInfos: UserOpInfo[]): Promise<void> {
        if (userOpInfos.length === 0) return

        // Use pipeline for atomic operations
        const pipeline = this.redis.pipeline()

        for (const userOpInfo of userOpInfos) {
            const { userOp } = userOpInfo
            const [nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
            const userOpHash = userOpInfo.userOpHash

            // Create composite score: nonceSequence in upper 32 bits, maxFeePerGas in lower 32 bits.
            const score =
                (nonceSequence << 32n) | (userOp.maxFeePerGas & 0xffffffffn)

            // Serialize userOpInfo for storage.
            const serializedUserOp = serialize(userOpInfo)

            // Add to main ready queue.
            pipeline.zadd(this.readyQueue, Number(score), userOpHash)

            // Add to sender+nonceKey index for fast lookup.
            const senderNonceQueue = this.getSenderNonceQueue(userOp)
            pipeline.zadd(senderNonceQueue, Number(nonceSequence), userOpHash)

            // Add to userOpHash map.
            pipeline.hset(this.userOpHashMap, userOpHash, serializedUserOp)

            // Add sender to deployment hash if this is a deployment.
            if (isDeployment(userOp)) {
                pipeline.hset(this.deploymentHashMap, userOp.sender, userOpHash)
            }
        }

        await pipeline.exec()
    }

    // Removes a userOp given its hash and returns the userOpInfo object.
    async remove(userOpHash: HexData32): Promise<UserOpInfo | undefined> {
        // Get serialized data to find all the keys we need to clean up.
        const serialized = await this.redis.hget(this.userOpHashMap, userOpHash)
        if (!serialized) {
            return undefined
        }

        // Parse to get stored values.
        const userOpInfo = deserialize(serialized)
        const { userOp } = userOpInfo
        const [, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
        const senderNonceQueue = this.getSenderNonceQueue(userOp)
        const isDeploymentOp = isDeployment(userOp)
        const sender = userOp.sender

        // Use pipeline for atomic-like operations.
        const pipeline = this.redis.pipeline()

        // Remove from ready queue.
        pipeline.zrem(this.readyQueue, userOpHash)

        // Remove from sender nonceKey queue.
        pipeline.zremrangebyscore(
            senderNonceQueue,
            Number(nonceSequence),
            Number(nonceSequence)
        )

        // Remove from hash lookup.
        pipeline.hdel(this.userOpHashMap, userOpHash)

        // Remove sender from deployment hash if this was a deployment.
        if (isDeploymentOp) {
            pipeline.hdel(this.deploymentHashMap, sender)
        }

        // Clean up empty sender index key.
        const count = await this.redis.zcard(senderNonceQueue)
        if (count === 0) {
            await this.redis.del(senderNonceQueue)
        }

        return userOpInfo
    }

    async pop(count: number): Promise<UserOpInfo[]> {
        // Pop from ready queue
        const results = await this.redis.zpopmax(this.readyQueue, count)
        if (!results || results.length === 0) {
            return []
        }

        const userOps: UserOpInfo[] = []

        // Process results (zpopmax returns [member, score, member, score, ...])
        for (let i = 0; i < results.length; i += 2) {
            const userOpHash = results[i] as HexData32
            const userOp = await this.remove(userOpHash)

            if (userOp) {
                userOps.push(userOp)
            }
        }

        return userOps
    }

    async getQueuedUserOps(userOp: UserOperation): Promise<UserOperation[]> {
        const [, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
        const senderIndexKey = this.getSenderNonceQueue(userOp)

        // Get all userOps with nonce sequence lower than the input
        // ZRANGEBYSCORE returns elements with scores between min and max
        // We want scores from 0 to (nonceSequence - 1)
        const serializedOps = await this.redis.zrangebyscore(
            senderIndexKey,
            0,
            Number(nonceSequence) - 1
        )

        // Deserialize and extract userOps
        return serializedOps.map((data) => deserialize(data).userOp)
    }

    // These methods aren't implemented
    dumpLocal() {
        return Promise.resolve([]) // We can't dump from redis as the latency is too high
    }

    clear(): Promise<void> {
        throw new Error("Not implemented: clear")
    }

    // Skip limit checks when using Redis
    validateQueuedLimit(): boolean {
        return true
    }

    validateParallelLimit(): boolean {
        return true
    }
}

export const createRedisOutstandingQueue = ({
    config,
    entryPoint,
    redisEndpoint,
    logger
}: {
    config: AltoConfig
    entryPoint: Address
    redisEndpoint: string
    logger: Logger
}): OutstandingStore => {
    return new RedisOutstandingQueue({
        config,
        entryPoint,
        redisEndpoint,
        logger
    })
}
