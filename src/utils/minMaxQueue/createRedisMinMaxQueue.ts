import Redis from "ioredis"

import type { Logger } from "@alto/utils"
import * as sentry from "@sentry/node"
import type { MinMaxQueue } from "."
import type { AltoConfig } from "../../createConfig"

// Sorted TTL queue, one queue to keep track of values and other queue to keep track of TTL.
class SortedTtlSet {
    redis: Redis
    valueKey: string
    timestampKey: string
    queueValidity: number

    constructor({
        keyPrefix,
        config,
        redisEndpoint
    }: {
        keyPrefix: string
        config: AltoConfig
        redisEndpoint: string
    }) {
        const redis = new Redis(redisEndpoint)
        const queueValidity = config.gasPriceExpiry

        const redisKey = `${config.chainId}:${keyPrefix}`

        this.redis = redis
        this.valueKey = `${redisKey}:value`
        this.timestampKey = `${redisKey}:timestamp`
        this.queueValidity = queueValidity
    }

    async add(value: bigint, logger: Logger) {
        try {
            await this.pruneExpiredEntries(logger)
            if (value === 0n) {
                return
            }

            const now = Date.now() / 1_000
            const valueStr = value.toString()

            // Check if value exists in the value set
            const exists = await this.redis.zscore(this.valueKey, valueStr)

            if (exists) {
                // If value exists, only update its timestamp
                const multi = this.redis.multi()
                multi.zrem(this.timestampKey, valueStr) // Remove old timestamp
                multi.zadd(this.timestampKey, now, valueStr) // Add new timestamp
                await multi.exec()
            } else {
                // If it's a new value, add entry to timestamp and value queues
                const multi = this.redis.multi()
                multi.zadd(this.timestampKey, now, valueStr)
                multi.zadd(this.valueKey, valueStr, valueStr)
                await multi.exec()
            }
        } catch (err) {
            logger.error({ err }, "Failed to save value to minMaxQueue")
            sentry.captureException(err)
        }
    }

    async pruneExpiredEntries(logger: Logger) {
        try {
            const timestamp = Date.now() / 1_000
            const cutoffTime = timestamp - this.queueValidity

            // Get expired unique IDs from time queue
            const expiredMembers = await this.redis.zrangebyscore(
                this.timestampKey,
                "-inf",
                `(${cutoffTime}` // exclusive upper bound
            )

            if (expiredMembers.length) {
                const multi = this.redis.multi()

                // Remove expired entries from both sets
                multi.zrem(this.timestampKey, ...expiredMembers)
                multi.zrem(this.valueKey, ...expiredMembers)
                await multi.exec()
            }
        } catch (err) {
            logger.error({ err }, "Failed to prune expired entries")
            sentry.captureException(err)
        }
    }

    async getMin(logger: Logger): Promise<bigint | null> {
        // Prune expired entries
        await this.pruneExpiredEntries(logger)

        // Get the smallest value from the value set
        const values = await this.redis.zrange(this.valueKey, 0, 0)
        if (values.length === 0) {
            return null
        }

        return BigInt(values[0])
    }

    async getMax(logger: Logger): Promise<bigint | null> {
        // Prune expired entries
        await this.pruneExpiredEntries(logger)

        // Get the largest value from the value set (using reverse range)
        const values = await this.redis.zrange(this.valueKey, -1, -1)
        if (values.length === 0) {
            return null
        }

        return BigInt(values[0])
    }

    async getLatestValue(logger: Logger): Promise<bigint | null> {
        // Prune expired entries
        await this.pruneExpiredEntries(logger)

        // Get the member with highest TTL (most recent timestamp)
        const values = await this.redis.zrange(this.timestampKey, -1, -1)
        if (values.length === 0) {
            return null
        }
        return BigInt(values[0])
    }
}

export const createRedisMinMaxQueue = ({
    config,
    keyPrefix,
    redisEndpoint
}: {
    config: AltoConfig
    keyPrefix: string
    redisEndpoint: string
}): MinMaxQueue => {
    const queue = new SortedTtlSet({
        config,
        redisEndpoint,
        keyPrefix: `${keyPrefix}:minMaxQueue`
    })

    const logger = config.getLogger(
        { module: "minMaxQueue" },
        {
            level: config.logLevel
        }
    )

    return {
        saveValue: async (value: bigint) => queue.add(value, logger),
        getLatestValue: async () => queue.getLatestValue(logger),
        getMinValue: async () => queue.getMin(logger),
        getMaxValue: async () => queue.getMax(logger)
    }
}
