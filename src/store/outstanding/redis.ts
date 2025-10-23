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
    private readonly redis: Redis

    private readonly senderNonceKeyPrefix: string // sender + nonceKey -> userOpHash
    private readonly readyQueue: string // Queue of userOpHashes (sorted by composite of userOp.nonceSeq + userOp.maxFeePerGas)
    private readonly userOpHashMap: string // userOpHash -> boolean
    private readonly deploymentHashMap: string // sender -> deployment userOpHash
    private readonly senderNonceQueueTtl: number // TTL for sender nonce queues in seconds

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

        // Calculate TTL for sender nonce queues (10 blocks worth of time)
        this.senderNonceQueueTtl = config.blockTime * 10

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
            const removedUserOps = await this.remove([conflictingHash])

            if (removedUserOps.length > 0) {
                return {
                    reason: "conflicting_nonce" as const,
                    userOpInfo: removedUserOps[0]
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
                const removedUserOps = await this.remove([
                    existingDeploymentHash
                ])

                if (removedUserOps.length > 0) {
                    return {
                        reason: "conflicting_deployment" as const,
                        userOpInfo: removedUserOps[0]
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
            const [, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
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
            pipeline.expire(senderNonceQueue, this.senderNonceQueueTtl)

            // Add to userOpHash map.
            pipeline.hset(this.userOpHashMap, userOpHash, serializedUserOp)

            // Add sender to deployment hash if this is a deployment.
            if (isDeployment(userOp)) {
                pipeline.hset(this.deploymentHashMap, userOp.sender, userOpHash)
            }
        }

        await pipeline.exec()
    }

    // Removes userOps given their hashes and returns the userOpInfo objects.
    async remove(userOpHashes: HexData32[]): Promise<UserOpInfo[]> {
        if (userOpHashes.length === 0) return []

        // Get all serialized data in parallel.
        const pipeline = this.redis.pipeline()
        for (const hash of userOpHashes) {
            pipeline.hget(this.userOpHashMap, hash)
        }
        const serializedResults = await pipeline.exec()

        const removedUserOps: UserOpInfo[] = []
        const removalPipeline = this.redis.pipeline()

        // Process each userOp that exists.
        for (let i = 0; i < userOpHashes.length; i++) {
            const serialized = serializedResults?.[i]?.[1] as string | null
            if (!serialized) continue

            const userOpHash = userOpHashes[i]
            const userOpInfo = deserialize(serialized)
            const { userOp } = userOpInfo
            const [, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
            const senderNonceQueue = this.getSenderNonceQueue(userOp)
            const isDeploymentOp = isDeployment(userOp)

            // Remove from ready queue.
            removalPipeline.zrem(this.readyQueue, userOpHash)

            // Remove from sender nonceKey queue.
            removalPipeline.zremrangebyscore(
                senderNonceQueue,
                Number(nonceSequence),
                Number(nonceSequence)
            )

            // Remove from hash lookup.
            removalPipeline.hdel(this.userOpHashMap, userOpHash)

            // Remove sender from deployment hash if this was a deployment.
            if (isDeploymentOp) {
                removalPipeline.hdel(this.deploymentHashMap, userOp.sender)
            }

            removedUserOps.push(userOpInfo)
        }

        // Execute all removals.
        await removalPipeline.exec()

        return removedUserOps
    }

    async pop(count: number): Promise<UserOpInfo[]> {
        // Pop from ready queue
        const results = await this.redis.zpopmax(this.readyQueue, count)
        if (!results || results.length === 0) {
            return []
        }

        // Extract hashes from results (zpopmax returns [member, score, member, score, ...])
        const userOpHashes: HexData32[] = []
        for (let i = 0; i < results.length; i += 2) {
            userOpHashes.push(results[i] as HexData32)
        }

        // Remove all userOps in batch
        return await this.remove(userOpHashes)
    }

    async getQueuedUserOps(userOp: UserOperation): Promise<UserOperation[]> {
        const [, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
        const senderNonceQueue = this.getSenderNonceQueue(userOp)

        // Get all userOpHashes with nonce sequence lower than the input
        // ZRANGEBYSCORE returns elements with scores between min and max
        // We want scores from 0 to (nonceSequence - 1)
        const userOpHashes = await this.redis.zrangebyscore(
            senderNonceQueue,
            0,
            Number(nonceSequence) - 1
        )

        if (userOpHashes.length === 0) return []

        // Fetch serialized data for each hash
        const pipeline = this.redis.pipeline()
        for (const hash of userOpHashes) {
            pipeline.hget(this.userOpHashMap, hash)
        }
        const results = await pipeline.exec()

        // Deserialize and extract userOps
        return (results || [])
            .map((result) => result?.[1] as string | null)
            .filter((serialized): serialized is string => serialized !== null)
            .map((serialized) => deserialize(serialized).userOp)
    }

    // These methods aren't implemented
    async dumpLocal(): Promise<UserOpInfo[]> {
        return [] // We can't dump from redis as the latency is too high
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
