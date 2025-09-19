/**
 * MinMaxQueue implementation in Redis using a single sorted set
 *
 * ## Data Structure
 * - Uses a Redis sorted set where:
 *   - Score: timestamp when value was added (seconds since epoch)
 *   - Member: the actual bigint value (stored as string)
 *
 * ## Flow
 * 1. **Adding values**: New values are added/updated with current timestamp as score
 * 2. **Reading values**: Queries filter out expired entries based on timestamp
 * 3. **Cleanup**: Background process runs every minute to remove expired entries
 *
 * ## Optimization Strategy
 * - Lazy cleanup: expired entries filtered on read, bulk removed by background process (removing is expensive)
 *
 * ## TTL Management
 * - Entries expire based on `queueValidity` (configured via `gasPriceExpiry`)
 * - Background cleanup prevents unbounded growth
 * - Read operations ignore expired entries without removing them
 */

import type { Redis } from "ioredis"

import type { Logger } from "@alto/utils"
import { getRedisPerformanceMarker } from "@alto/utils"
import * as sentry from "@sentry/node"
import type { MinMaxQueue } from "."
import type { AltoConfig } from "../../createConfig"

class SortedTtlSet {
    redis: Redis
    redisKey: string // Single sorted set: score = timestamp, member = value
    queueValidity: number
    private cleanupInterval: NodeJS.Timeout | null = null
    private logger: Logger

    constructor({
        queueName,
        config,
        redis,
        logger
    }: {
        queueName: string
        config: AltoConfig
        redis: Redis
        logger: Logger
    }) {
        const queueValidity = config.gasPriceExpiry

        this.redis = redis
        this.redisKey = `${config.redisKeyPrefix}:${config.chainId}:${queueName}`
        this.queueValidity = queueValidity
        this.logger = logger

        // Start background cleanup every minute
        this.startBackgroundCleanup()
    }

    private startBackgroundCleanup() {
        // Run cleanup every minute
        this.cleanupInterval = setInterval(() => {
            this.cleanup().catch((err) => {
                sentry.captureException(err)
            })
        }, 60 * 1000)

        // Allow process to exit even if interval is active
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref()
        }
    }

    async cleanup(): Promise<void> {
        const cutoffTime = Date.now() / 1_000 - this.queueValidity * 5
        const start = performance.now()
        await this.redis.zremrangebyscore(
            this.redisKey,
            "-inf",
            `(${cutoffTime}`
        )
        const durationMs = performance.now() - start
        const duration = durationMs.toFixed(2)
        const perfMarker = getRedisPerformanceMarker(durationMs)
        this.logger.info(`[debug-redis, ${perfMarker}] zremrangebyscore (cleanup) took ${duration}ms`)
    }

    async add(value: bigint, logger: Logger) {
        try {
            if (value === 0n) {
                return
            }

            const now = Date.now() / 1_000
            const valueStr = value.toString()

            // Add or update (if exists) with current timestamp
            const start = performance.now()
            await this.redis.zadd(this.redisKey, now, valueStr)
            const durationMs = performance.now() - start
            const duration = durationMs.toFixed(2)
            const perfMarker = getRedisPerformanceMarker(durationMs)
            this.logger.info(`[debug-redis, ${perfMarker}] zadd took ${duration}ms`)
        } catch (err) {
            logger.error({ err }, "Failed to save value to minMaxQueue")
            sentry.captureException(err)
        }
    }

    private getValidCutoffTime(): number {
        return Date.now() / 1_000 - this.queueValidity
    }

    async getMin(logger: Logger): Promise<bigint | null> {
        try {
            // Get all valid (non-expired) values
            const start = performance.now()
            const validValues = await this.redis.zrangebyscore(
                this.redisKey,
                this.getValidCutoffTime(),
                "+inf"
            )
            const durationMs = performance.now() - start
            const duration = durationMs.toFixed(2)
            const perfMarker = getRedisPerformanceMarker(durationMs)
            this.logger.info(`[debug-redis, ${perfMarker}] zrangebyscore (getMin) took ${duration}ms`)

            if (validValues.length === 0) {
                return null
            }

            // Find minimum value among valid entries
            const bigIntValues = validValues.map((v) => BigInt(v))
            return bigIntValues.reduce((min, val) => (val < min ? val : min))
        } catch (err) {
            logger.error({ err }, "Failed to get min value")
            sentry.captureException(err)
            return null
        }
    }

    async getMax(logger: Logger): Promise<bigint | null> {
        try {
            // Get all valid (non-expired) values
            const start = performance.now()
            const validValues = await this.redis.zrangebyscore(
                this.redisKey,
                this.getValidCutoffTime(),
                "+inf"
            )
            const durationMs = performance.now() - start
            const duration = durationMs.toFixed(2)
            const perfMarker = getRedisPerformanceMarker(durationMs)
            this.logger.info(`[debug-redis, ${perfMarker}] zrangebyscore (getMax) took ${duration}ms`)

            if (validValues.length === 0) {
                return null
            }

            // Find maximum value among valid entries
            const bigIntValues = validValues.map((v) => BigInt(v))
            return bigIntValues.reduce((max, val) => (val > max ? val : max))
        } catch (err) {
            logger.error({ err }, "Failed to get max value")
            sentry.captureException(err)
            return null
        }
    }

    async getLatestValue(logger: Logger): Promise<bigint | null> {
        try {
            // Get the most recently added value (highest timestamp) that's still valid
            const start = performance.now()
            const validValues = await this.redis.zrevrangebyscore(
                this.redisKey,
                "+inf",
                this.getValidCutoffTime(),
                "LIMIT",
                0,
                1
            )
            const durationMs = performance.now() - start
            const duration = durationMs.toFixed(2)
            const perfMarker = getRedisPerformanceMarker(durationMs)
            this.logger.info(`[debug-redis, ${perfMarker}] zrevrangebyscore (getLatestValue) took ${duration}ms`)

            if (validValues.length === 0) {
                return null
            }

            return BigInt(validValues[0])
        } catch (err) {
            logger.error({ err }, "Failed to get latest value")
            sentry.captureException(err)
            return null
        }
    }
}

export const createRedisMinMaxQueue = ({
    config,
    queueName,
    redis
}: {
    config: AltoConfig
    queueName: string
    redis: Redis
}): MinMaxQueue => {
    const logger = config.getLogger(
        { module: "minMaxQueue" },
        {
            level: config.logLevel
        }
    )

    const queue = new SortedTtlSet({
        config,
        redis,
        queueName,
        logger
    })

    return {
        saveValue: async (value: bigint) => queue.add(value, logger),
        getLatestValue: async () => queue.getLatestValue(logger),
        getMinValue: async () => queue.getMin(logger),
        getMaxValue: async () => queue.getMax(logger)
    }
}
