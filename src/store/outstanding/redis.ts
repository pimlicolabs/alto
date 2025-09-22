import {
    type Address,
    type HexData32,
    type UserOpInfo,
    type UserOperation,
    userOpInfoSchema
} from "@alto/types"
import { getNonceKeyAndSequence, getUserOpHash } from "@alto/utils"
import { Redis } from "ioredis"
import type { Logger } from "pino"
import { toHex } from "viem/utils"
import type { AltoConfig } from "../../createConfig"
import type { OutstandingStore } from "./types"
import { PublicClient } from "viem"

const serializeUserOpInfo = (userOpInfo: UserOpInfo): string => {
    const [nonceKey, nonceSequence] = getNonceKeyAndSequence(
        userOpInfo.userOp.nonce
    )
    const enhanced = {
        ...userOpInfo,
        _nonceKey: toHex(nonceKey),
        _nonceSequence: Number(nonceSequence)
    }
    return JSON.stringify(enhanced, (_, value) =>
        typeof value === "bigint" ? toHex(value) : value
    )
}

const deserializeUserOpInfo = (data: string): UserOpInfo => {
    const parsed = JSON.parse(data)
    return userOpInfoSchema.parse(parsed)
}

class RedisOutstandingQueue implements OutstandingStore {
    private redis: Redis

    // Args for getting userOpHash
    private entryPointAddress: Address
    private chainId: number
    private publicClient: PublicClient

    // Redis key names
    private readyQueueKey: string
    private senderIndexPrefix: string

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

        // Setup args for getting userOpHash.
        this.entryPointAddress = entryPoint
        this.chainId = config.chainId
        this.publicClient = config.publicClient

        // Initialize Redis key names
        const redisPrefix = `${config.redisKeyPrefix}:${config.chainId}:${entryPoint}:outstanding`
        this.readyQueueKey = `${redisPrefix}:ready-queue`
        this.senderIndexPrefix = `${redisPrefix}:sender`

        // Register Lua script for atomic pop operation with index cleanup
        this.redis.defineCommand("popUserOps", {
            numberOfKeys: 2,
            lua: `
                local readyQueueKey = KEYS[1]
                local indexPrefix = KEYS[2]
                local count = tonumber(ARGV[1])

                local results = redis.call('ZPOPMAX', readyQueueKey, count)
                if #results == 0 then
                    return {}
                end

                local userOps = {}
                for i = 1, #results, 2 do
                    local serialized = results[i]
                    local parsed = cjson.decode(serialized)

                    -- Extract sender, nonceKey, and nonceSequence from the enhanced data
                    local sender = parsed.userOp.sender
                    local nonceKey = parsed._nonceKey
                    local nonceSequence = parsed._nonceSequence

                    -- Clean up the sender+nonceKey index using score
                    local senderIndexKey = indexPrefix .. ':' .. sender .. ':' .. nonceKey
                    redis.call('ZREMRANGEBYSCORE', senderIndexKey, nonceSequence, nonceSequence)

                    -- Delete the key if the set is now empty
                    if redis.call('ZCARD', senderIndexKey) == 0 then
                        redis.call('DEL', senderIndexKey)
                    end

                    table.insert(userOps, serialized)
                end

                return userOps
            `
        })

        logger.info(
            {
                readyQueueKey: this.readyQueueKey
            },
            "Using redis for outstanding mempool."
        )
    }

    // OutstandingStore methods
    async contains(userOp: UserOperation): Promise<boolean> {
        const [nonceKey, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
        const senderIndexKey = `${this.senderIndexPrefix}:${userOp.sender}:${nonceKey}`

        // Get the userOp at this nonce sequence
        const serializedOps = await this.redis.zrangebyscore(
            senderIndexKey,
            Number(nonceSequence),
            Number(nonceSequence)
        )

        if (serializedOps.length === 0) {
            return false
        }

        // Deserialize and check if the hash matches
        const storedUserOpInfo = deserializeUserOpInfo(serializedOps[0])
        const userOpHash = getUserOpHash({
            userOp,
            entryPointAddress: this.entryPointAddress,
            chainId: this.chainId,
            publicClient: this.publicClient
        })
        return storedUserOpInfo.userOpHash === userOpHash
    }

    async popConflicting(_userOp: UserOperation) {
        return undefined
    }

    async add(userOpInfos: UserOpInfo[]): Promise<void> {
        if (userOpInfos.length === 0) return

        // Use pipeline for atomic operations
        const pipeline = this.redis.pipeline()

        for (const userOpInfo of userOpInfos) {
            const { userOp } = userOpInfo
            const [nonceKey, nonceSequence] = getNonceKeyAndSequence(
                userOp.nonce
            )

            // Create composite score: nonceSequence in upper 32 bits, maxFeePerGas in lower 32 bits
            const score =
                (nonceSequence << 32n) | (userOp.maxFeePerGas & 0xffffffffn)

            // Serialize userOpInfo for storage
            const serialized = serializeUserOpInfo(userOpInfo)

            // Add to main ready queue
            pipeline.zadd(this.readyQueueKey, Number(score), serialized)

            // Add to sender+nonceKey index for fast lookup
            const senderIndexKey = `${this.senderIndexPrefix}:${userOp.sender}:${nonceKey}`
            pipeline.zadd(senderIndexKey, Number(nonceSequence), serialized)
        }

        await pipeline.exec()
    }

    async remove(_userOpHash: HexData32): Promise<boolean> {
        return false
    }

    async pop(count: number): Promise<UserOpInfo[]> {
        // Use atomic Lua script for pop operation with index cleanup
        // @ts-ignore - defineCommand adds the method at runtime
        const results = (await this.redis.popUserOps(
            this.readyQueueKey,
            this.senderIndexPrefix,
            count
        )) as string[]

        return results.map((data) => deserializeUserOpInfo(data))
    }

    async getQueuedUserOps(userOp: UserOperation): Promise<UserOperation[]> {
        const [nonceKey, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
        const senderIndexKey = `${this.senderIndexPrefix}:${userOp.sender}:${nonceKey}`

        // Get all userOps with nonce sequence lower than the input
        // ZRANGEBYSCORE returns elements with scores between min and max
        // We want scores from 0 to (nonceSequence - 1)
        const serializedOps = await this.redis.zrangebyscore(
            senderIndexKey,
            0,
            Number(nonceSequence) - 1
        )

        // Deserialize and extract userOps
        return serializedOps.map((data) => deserializeUserOpInfo(data).userOp)
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
