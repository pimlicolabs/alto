import Redis from "ioredis"
import { MinMaxQueue } from "."

// Sorted TTL queue, one queue to keep track of values and other queue to keep track of TTL.
class SortedTtlSet {
    redis: Redis
    valueKey: string
    timestampKey: string
    queueValidity: number

    constructor({
        redis,
        key,
        queueValidity
    }: { redis: Redis; key: string; queueValidity: number }) {
        this.redis = redis
        this.valueKey = `${key}:value`
        this.timestampKey = `${key}:timestamp`
        this.queueValidity = queueValidity
    }

    async add(value: bigint, ttl: number) {
        const now = Date.now() / 1_000
        const newExpiry = now + ttl
        const valueStr = value.toString()

        // Check if value exists in the value set
        const exists = await this.redis.zscore(this.valueKey, valueStr)

        if (exists) {
            // If value exists, only update its timestamp
            const multi = this.redis.multi()
            multi.zrem(this.timestampKey, valueStr) // Remove old timestamp
            multi.zadd(this.timestampKey, newExpiry, valueStr) // Add new timestamp
            await multi.exec()
        } else {
            // If it's a new value, add entry to timestamp and value queues
            const multi = this.redis.multi()
            multi.zadd(this.timestampKey, newExpiry, valueStr)
            multi.zadd(this.valueKey, valueStr, valueStr)
            await multi.exec()
        }
    }

    async pruneExpiredEntries() {
        const timestamp = Date.now() / 1_000
        const cutoffTime = timestamp - this.queueValidity

        // Get expired unique IDs from time queue
        const expiredMembers = await this.redis.zrangebyscore(
            this.timestampKey,
            "-inf",
            cutoffTime
        )

        if (expiredMembers.length) {
            const multi = this.redis.multi()

            // Remove expired entries from both sets
            multi.zrem(this.timestampKey, ...expiredMembers)
            multi.zrem(this.valueKey, ...expiredMembers)
            await multi.exec()
        }
    }
}

export const createRedisMinMaxQueue = ({
    redis,
    queueValidityMs,
    keyPrefix
}: {
    redis: Redis
    queueValidityMs: number
    keyPrefix: string
}): MinMaxQueue => {
    const keys = {
        minDeque: `${keyPrefix}:minDeque`,
        maxDeque: `${keyPrefix}:maxDeque`,
        latestValue: `${keyPrefix}:latestValue`
    }

    return {
        saveValue: async (value: bigint) => {
            if (value === 0n) {
                return
            }
            await updateQueues({ redis, keys, value, queueValidityMs })
        },

        getLatestValue: async () => {
            const value = await redis.get(keys.latestValue)
            return value ? BigInt(value) : null
        },

        getMinValue: async () => {
            const entries = await redis.zrange(keys.minDeque, 0, 0)
            if (!entries.length) return null
            const entry = JSON.parse(entries[0]) as QueueEntry
            return BigInt(entry.value)
        },

        getMaxValue: async () => {
            const entries = await redis.zrange(keys.maxDeque, 0, 0)
            if (!entries.length) return null
            const entry = JSON.parse(entries[0]) as QueueEntry
            return BigInt(entry.value)
        }
    }
}
