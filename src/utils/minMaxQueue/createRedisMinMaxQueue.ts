import Redis from "ioredis"

import { MinMaxQueue } from "."
import { AltoConfig } from "../../createConfig"

// Sorted TTL queue, one queue to keep track of values and other queue to keep track of TTL.
class SortedTtlSet {
    redis: Redis
    valueKey: string
    timestampKey: string
    queueValidity: number

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

        const startTime = performance.now()
        console.log(`[LATENCY] Redis connection initialization started`)
        
        const redis = new Redis(config.redisGasPriceQueueUrl)
        const endTime = performance.now()
        console.log(`[LATENCY] STEP 0: Redis connection initialization time: ${endTime - startTime}ms`)
        
        // Add connection status listener
        redis.on('ready', () => {
            console.log(`[LATENCY] Redis connection ready`)
        })
        
        redis.on('error', (err) => {
            console.error(`[LATENCY] Redis connection error: ${err}`)
        })
        
        redis.on('connect', () => {
            console.log(`[LATENCY] Redis connected`)
        })
        
        redis.on('reconnecting', () => {
            console.log(`[LATENCY] Redis reconnecting...`)
        })
        
        const queueValidity = config.gasPriceExpiry

        const redisKey = `${config.chainId}:${keyPrefix}`

        this.redis = redis
        this.valueKey = `${redisKey}:value`
        this.timestampKey = `${redisKey}:timestamp`
        this.queueValidity = queueValidity
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
            await multi.exec()
        } else {
            // If it's a new value, add entry to timestamp and value queues
            const multi = this.redis.multi()
            multi.zadd(this.timestampKey, now, valueStr)
            multi.zadd(this.valueKey, valueStr, valueStr)
            await multi.exec()
        }
    }

    async pruneExpiredEntries() {
        const pruneStart = performance.now()
        const timestamp = Date.now() / 1_000
        const cutoffTime = timestamp - this.queueValidity

        // Get expired unique IDs from time queue
        const rangeStart = performance.now()
        const expiredMembers = await this.redis.zrangebyscore(
            this.timestampKey,
            "-inf",
            `(${cutoffTime}` // exclusive upper bound
        )
        const rangeEnd = performance.now()
        console.log(`[LATENCY] STEP 5.3.2.3.1.1: Redis zrangebyscore operation time: ${rangeEnd - rangeStart}ms`)

        if (expiredMembers.length) {
            const multiStart = performance.now()
            const multi = this.redis.multi()

            // Remove expired entries from both sets
            multi.zrem(this.timestampKey, ...expiredMembers)
            multi.zrem(this.valueKey, ...expiredMembers)
            await multi.exec()
            const multiEnd = performance.now()
            console.log(`[LATENCY] STEP 5.3.2.3.1.2: Redis multi-zrem operation time: ${multiEnd - multiStart}ms`)
        }
        
        const pruneEnd = performance.now()
        console.log(`[LATENCY] STEP 5.3.2.3.1.3: Redis pruneExpiredEntries total time: ${pruneEnd - pruneStart}ms`)
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
        const startTime = performance.now()
        
        // Prune expired entries
        const pruneStartTime = performance.now()
        await this.pruneExpiredEntries()
        const pruneEndTime = performance.now()
        
        console.log(`[LATENCY] STEP 5.3.2.3.1: Redis queue prune time: ${pruneEndTime - pruneStartTime}ms`)

        // Get the member with highest TTL (most recent timestamp)
        const zrangeStartTime = performance.now()
        const values = await this.redis.zrange(this.timestampKey, -1, -1)
        const zrangeEndTime = performance.now()
        
        console.log(`[LATENCY] STEP 5.3.2.3.2: Redis zrange operation time: ${zrangeEndTime - zrangeStartTime}ms`)
        
        if (!values.length) return null

        const endTime = performance.now()
        console.log(`[LATENCY] STEP 5.3.2.3.3: Redis getLatestValue total time: ${endTime - startTime}ms`)
        
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
