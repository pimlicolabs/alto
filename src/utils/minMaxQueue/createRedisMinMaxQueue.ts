import Redis from "ioredis"

import { MinMaxQueue } from "."
import { AltoConfig } from "../../createConfig"
import { Logger } from "@alto/utils"
import * as sentry from "@sentry/node"

// Sorted TTL queue, one queue to keep track of values and other queue to keep track of TTL.
class SortedTtlSet {
    redis: Redis
    valueKey: string
    timestampKey: string
    queueValidity: number
    logger: Logger

    constructor({
        keyPrefix,
        config
    }: {
        keyPrefix: string
        config: AltoConfig
    }) {
        if (!config.redisGasPriceQueueUrl) {
            throw new Error("Redis URL not provided")
        }

        const redis = new Redis(config.redisGasPriceQueueUrl)
        const queueValidity = config.gasPriceExpiry

        const redisKey = `${config.chainId}:${keyPrefix}`

        this.redis = redis
        this.valueKey = `${redisKey}:value`
        this.timestampKey = `${redisKey}:timestamp`
        this.queueValidity = queueValidity
        this.logger = config.getLogger({ module: "redis-minmax-queue" })
    }

    async add(value: bigint) {
        await this.pruneExpiredEntries()
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
            try {
                await multi.exec()
            } catch (err) {
                this.logger.error(
                    {
                        err
                    },
                    "Redis transaction failed in SortedTtlSet.add (update)"
                )
                sentry.captureException(err)
                throw new Error(
                    `Redis transaction failed in SortedTtlSet.add (update): ${
                        err instanceof Error ? err.message : String(err)
                    }`
                )
            }
        } else {
            // If it's a new value, add entry to timestamp and value queues
            const multi = this.redis.multi()
            multi.zadd(this.timestampKey, now, valueStr)
            multi.zadd(this.valueKey, valueStr, valueStr)
            try {
                await multi.exec()
            } catch (err) {
                this.logger.error(
                    {
                        err
                    },
                    "Redis transaction failed in SortedTtlSet.add (new)"
                )
                sentry.captureException(err)
                throw new Error(
                    `Redis transaction failed in SortedTtlSet.add (new): ${
                        err instanceof Error ? err.message : String(err)
                    }`
                )
            }
        }
    }

    async pruneExpiredEntries() {
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
            try {
                await multi.exec()
            } catch (err) {
                this.logger.error(
                    {
                        err
                    },
                    "Redis transaction failed in SortedTtlSet.pruneExpiredEntries"
                )
                sentry.captureException(err)
                throw new Error(
                    `Redis transaction failed in SortedTtlSet.pruneExpiredEntries: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                )
            }
        }
    }

    async getMin(): Promise<bigint | null> {
        // Prune expired entries
        await this.pruneExpiredEntries()

        // Get the smallest value from the value set
        const values = await this.redis.zrange(this.valueKey, 0, 0)
        if (!values.length) return null

        return BigInt(values[0])
    }

    async getMax(): Promise<bigint | null> {
        // Prune expired entries
        await this.pruneExpiredEntries()

        // Get the largest value from the value set (using reverse range)
        const values = await this.redis.zrange(this.valueKey, -1, -1)
        if (!values.length) return null

        return BigInt(values[0])
    }

    async getLatestValue(): Promise<bigint | null> {
        // Prune expired entries
        await this.pruneExpiredEntries()

        // Get the member with highest TTL (most recent timestamp)
        const values = await this.redis.zrange(this.timestampKey, -1, -1)
        if (!values.length) return null

        return BigInt(values[0])
    }
}

export const createRedisMinMaxQueue = ({
    config,
    keyPrefix
}: {
    config: AltoConfig
    keyPrefix: string
}): MinMaxQueue => {
    const queue = new SortedTtlSet({
        config,
        keyPrefix: `${keyPrefix}:minMaxQueue`
    })

    return {
        saveValue: async (value: bigint) => queue.add(value),
        getLatestValue: async () => queue.getLatestValue(),
        getMinValue: async () => queue.getMin(),
        getMaxValue: async () => queue.getMax()
    }
}
