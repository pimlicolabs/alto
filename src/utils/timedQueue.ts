import type { AltoConfig } from "@alto/config"
import { maxBigInt, minBigInt } from "./bigInt"
import { Redis } from "ioredis"
import type { Logger } from "pino"

export interface TimedQueue {
    saveValue(value: bigint): Promise<void>
    getLatestValue(): Promise<bigint | null>
    getMinValue(): Promise<bigint | undefined>
    getMaxValue(): Promise<bigint | undefined>
    isEmpty(): Promise<boolean>
}

export class RedisTimedQueue implements TimedQueue {
    private redisClient: Redis
    private queueKey: string
    private queueValidity: number
    private logger: Logger
    private tag: string

    constructor({ config, tag }: { config: AltoConfig; tag: string }) {
        const { redisMempoolUrl } = config

        if (!redisMempoolUrl) {
            throw new Error("Redis mempool URL is not set")
        }

        const queueValidity = config.gasPriceExpiry * 1_000

        this.redisClient = new Redis(redisMempoolUrl)

        this.tag = `${tag}-${config.publicClient.chain.id}`
        this.queueKey = `${config.redisGasPriceQueueName}-${this.tag}`
        this.queueValidity = queueValidity

        this.logger = config.getLogger(
            { module: "RedisTimedQueue" },
            {
                level: config.mempoolLogLevel || config.logLevel
            }
        )
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

            this.logger.info(
                { value, timestamp },
                "[RedisTimedQueue] Pruning expired entries"
            )

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

        this.logger.info(
            { value, timestamp, tag: this.tag },
            "[RedisTimedQueue] Saving value"
        )

        // Directly add the value with its timestamp as the score
        await this.redisClient.zadd(
            this.queueKey,
            timestamp.toString(),
            value.toString()
        )
    }

    public async getLatestValue(): Promise<bigint | null> {
        const allEntries = await this.redisClient.zrange(
            this.queueKey,
            0,
            -1,
            "WITHSCORES"
        )

        // sort all entries by timestamp
        let latestValue: bigint | null = null
        let latestTimestamp = 0

        for (let i = 0; i < allEntries.length; i += 2) {
            const value = BigInt(allEntries[i])
            const timestamp = Number.parseInt(allEntries[i + 1])
            if (timestamp > latestTimestamp) {
                latestTimestamp = timestamp
                latestValue = value
            }
        }

        return latestValue
    }

    public async getMinValue(): Promise<bigint | undefined> {
        const minEntry = await this.redisClient.zrange(this.queueKey, 0, 0)

        const allEntries = await this.redisClient.zrange(
            this.queueKey,
            0,
            -1,
            "WITHSCORES"
        )

        const allValues: bigint[] = []

        for (let i = 0; i < allEntries.length; i += 2) {
            const value = BigInt(allEntries[i])
            allValues.push(value)
        }

        this.logger.info(
            { minEntry, allValues },
            "[RedisTimedQueue] Getting min value"
        )

        return minEntry.length === 0 ? undefined : BigInt(minEntry[0])
    }

    public async getMaxValue(): Promise<bigint | undefined> {
        const maxEntry = await this.redisClient.zrevrange(this.queueKey, 0, 0)

        this.logger.info({ maxEntry }, "[RedisTimedQueue] Getting max value")

        return maxEntry.length === 0 ? undefined : BigInt(maxEntry[0])
    }

    public async isEmpty(): Promise<boolean> {
        const queueSize = await this.redisClient.zcard(this.queueKey)
        this.logger.info({ queueSize }, "[RedisTimedQueue] Checking if empty")
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
    private logger: Logger

    constructor(config: AltoConfig) {
        const queueValidity = config.gasPriceExpiry * 1_000
        this.queue = []
        this.maxQueueSize = queueValidity / 1_000
        this.queueValidity = queueValidity
        this.logger = config.getLogger(
            { module: "MemoryTimedQueue" },
            {
                level: config.mempoolLogLevel || config.logLevel
            }
        )
    }

    // Only saves the value if it is lower than the latest value.
    public saveValue(value: bigint): Promise<void> {
        if (value === 0n) {
            return Promise.resolve()
        }

        const last = this.queue[this.queue.length - 1]
        const timestamp = Date.now()

        this.logger.info(
            { value, timestamp },
            "[MemoryTimedQueue] Saving value"
        )

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

    public getLatestValue(): Promise<bigint | null> {
        if (this.queue.length === 0) {
            return Promise.resolve(null)
        }

        this.logger.info(
            { value: this.queue[this.queue.length - 1].value },
            "[MemoryTimedQueue] Getting latest value"
        )

        return Promise.resolve(this.queue[this.queue.length - 1].value)
    }

    public getMinValue(): Promise<bigint | undefined> {
        if (this.queue.length === 0) {
            return Promise.resolve(undefined)
        }

        this.logger.info(
            { value: this.queue[0].value },
            "[MemoryTimedQueue] Getting min value"
        )

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

        this.logger.info(
            { value: this.queue[0].value },
            "[MemoryTimedQueue] Getting max value"
        )

        return Promise.resolve(
            this.queue.reduce(
                (acc, cur) => maxBigInt(cur.value, acc),
                this.queue[0].value
            )
        )
    }

    public isEmpty(): Promise<boolean> {
        this.logger.info(
            { queueLength: this.queue.length },
            "[MemoryTimedQueue] Checking if empty"
        )
        return Promise.resolve(this.queue.length === 0)
    }
}

export const getTimedQueue = ({
    config,
    tag
}: { config: AltoConfig; tag: string }): TimedQueue => {
    const logger = config.getLogger(
        { module: "getTimedQueue" },
        {
            level: config.mempoolLogLevel || config.logLevel
        }
    )

    logger.info("[getTimedQueue] Initializing timed queue")

    if (config.redisMempoolUrl) {
        logger.info("[getTimedQueue] Using RedisTimedQueue")
        return new RedisTimedQueue({ config, tag })
    }

    logger.info("[getTimedQueue] Using MemoryTimedQueue")
    return new MemoryTimedQueue(config)
}
