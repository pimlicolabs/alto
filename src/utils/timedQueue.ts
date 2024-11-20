import type { AltoConfig } from "@alto/config"
import { maxBigInt, minBigInt } from "./bigInt"
import { Redis } from "ioredis"

export interface TimedQueue {
    saveValue(value: bigint): Promise<void>
    getLatestValue(): bigint | null
    getMinValue(): Promise<bigint | undefined>
    getMaxValue(): Promise<bigint | undefined>
    isEmpty(): Promise<boolean>
}

export class RedisTimedQueue implements TimedQueue {
    private redisClient: Redis
    private queueKey: string
    private queueValidity: number
    private latestValue: bigint | null

    constructor(config: AltoConfig) {
        const { redisMempoolUrl } = config

        if (!redisMempoolUrl) {
            throw new Error("Redis mempool URL is not set")
        }

        const queueValidity = config.gasPriceExpiry * 1_000

        this.redisClient = new Redis(redisMempoolUrl)
        this.queueKey = config.redisGasPriceQueueName
        this.queueValidity = queueValidity
        this.latestValue = null
    }

    private async pruneExpiredEntries() {
        const currentTime = Date.now()
        const allEntries = await this.redisClient.zrange(
            this.queueKey,
            0,
            -1,
            "WITHSCORES"
        )

        for (let i = 0; i < allEntries.length; i += 2) {
            const value = BigInt(allEntries[i])
            const timestamp = Number.parseInt(allEntries[i + 1])
            if (currentTime - timestamp > this.queueValidity) {
                await this.redisClient.zrem(this.queueKey, value.toString())
            } else {
                break // Since the sorted set is sorted, no further entries need to be checked.
            }
        }
    }

    public async saveValue(value: bigint): Promise<void> {
        if (value === 0n) return

        const timestamp = Date.now()
        await this.pruneExpiredEntries()

        // Directly add the value with its timestamp as the score
        await this.redisClient.zadd(
            this.queueKey,
            timestamp.toString(),
            value.toString()
        )
        this.latestValue = value
    }

    public getLatestValue(): bigint | null {
        return this.latestValue
    }

    public async getMinValue(): Promise<bigint | undefined> {
        const minEntry = await this.redisClient.zrange(this.queueKey, 0, 0)
        return minEntry.length === 0 ? undefined : BigInt(minEntry[0])
    }

    public async getMaxValue(): Promise<bigint | undefined> {
        const maxEntry = await this.redisClient.zrevrange(this.queueKey, 0, 0)
        return maxEntry.length === 0 ? undefined : BigInt(maxEntry[0])
    }

    public async isEmpty(): Promise<boolean> {
        const queueSize = await this.redisClient.zcard(this.queueKey)
        return queueSize === 0
    }

    public async close() {
        await this.redisClient.quit()
    }
}

export class MemoryTimedQueue implements TimedQueue {
    private queue: { timestamp: number; value: bigint }[]
    private maxQueueSize: number
    private queueValidity: number

    constructor(config: AltoConfig) {
        const queueValidity = config.gasPriceExpiry * 1_000
        this.queue = []
        this.maxQueueSize = queueValidity / 1_000
        this.queueValidity = queueValidity
    }

    // Only saves the value if it is lower than the latest value.
    public saveValue(value: bigint): Promise<void> {
        if (value === 0n) {
            return Promise.resolve()
        }

        const last = this.queue[this.queue.length - 1]
        const timestamp = Date.now()

        if (!last || timestamp - last.timestamp >= this.queueValidity) {
            if (this.queue.length >= this.maxQueueSize) {
                this.queue.shift()
            }
            this.queue.push({ value, timestamp })
        } else if (value < last.value) {
            last.value = value
            last.timestamp = timestamp
        }
        return Promise.resolve()
    }

    public getLatestValue(): bigint | null {
        if (this.queue.length === 0) {
            return null
        }
        return this.queue[this.queue.length - 1].value
    }

    public getMinValue(): Promise<bigint | undefined> {
        if (this.queue.length === 0) {
            return Promise.resolve(undefined)
        }

        return Promise.resolve(
            this.queue.reduce(
                (acc, cur) => minBigInt(cur.value, acc),
                this.queue[0].value
            )
        )
    }

    public getMaxValue(): Promise<bigint | undefined> {
        if (this.queue.length === 0) {
            return Promise.resolve(undefined)
        }

        return Promise.resolve(
            this.queue.reduce(
                (acc, cur) => maxBigInt(cur.value, acc),
                this.queue[0].value
            )
        )
    }

    public isEmpty(): Promise<boolean> {
        return Promise.resolve(this.queue.length === 0)
    }
}

export const getTimedQueue = (config: AltoConfig): TimedQueue => {
    if (config.redisMempoolUrl) {
        return new RedisTimedQueue(config)
    }
    return new MemoryTimedQueue(config)
}
