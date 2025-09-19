import type { Metrics } from "@alto/utils"
import { getRedisPerformanceMarker } from "@alto/utils"
import type { Redis } from "ioredis"
import type { Account } from "viem"
import { getAvailableWallets } from "."
import type { AltoConfig } from "../../createConfig"
import type { SenderManager } from "../senderManager"
import { getRedis } from "../../redis/getRedis"

async function createRedisQueue({
    redis,
    name,
    entries,
    logger
}: {
    redis: Redis
    name: string
    entries: string[]
    logger: any
}) {
    const start = performance.now()
    const hasElements = await redis.llen(name)
    const durationMs = performance.now() - start
    const duration = durationMs.toFixed(2)
    const perfMarker = getRedisPerformanceMarker(durationMs)
    logger.info(`[debug-redis, ${perfMarker}] llen (init) took ${duration}ms`)

    // Ensure queue is populated on startup
    // Avoids race case where queue is populated twice due to multi (atomic txs)
    if (hasElements === 0) {
        const multi = redis.multi()
        multi.del(name)
        multi.rpush(name, ...entries)
        const multiStart = performance.now()
        await multi.exec()
        const multiDurationMs = performance.now() - multiStart
        const multiDuration = multiDurationMs.toFixed(2)
        const multiPerfMarker = getRedisPerformanceMarker(multiDurationMs)
        logger.info(`[debug-redis, ${multiPerfMarker}] multi (init queue) took ${multiDuration}ms`)
    }

    return {
        llen: async () => {
            const start = performance.now()
            const result = await redis.llen(name)
            const durationMs = performance.now() - start
            const duration = durationMs.toFixed(2)
            const perfMarker = getRedisPerformanceMarker(durationMs)
            logger.info(`[debug-redis, ${perfMarker}] llen took ${duration}ms`)
            return result
        },
        pop: async () => {
            const start = performance.now()
            const result = await redis.rpop(name)
            const durationMs = performance.now() - start
            const duration = durationMs.toFixed(2)
            const perfMarker = getRedisPerformanceMarker(durationMs)
            logger.info(`[debug-redis, ${perfMarker}] rpop took ${duration}ms`)
            return result
        },
        push: async (entry: string) => {
            const start = performance.now()
            const result = await redis.lpush(name, entry)
            const durationMs = performance.now() - start
            const duration = durationMs.toFixed(2)
            const perfMarker = getRedisPerformanceMarker(durationMs)
            logger.info(`[debug-redis, ${perfMarker}] lpush took ${duration}ms`)
            return result
        }
    }
}

const delay = async (delay: number) => {
    await new Promise((resolve) => setTimeout(resolve, delay))
}

export const createRedisSenderManager = async ({
    config,
    metrics
}: {
    config: AltoConfig
    metrics: Metrics
}): Promise<SenderManager> => {
    const wallets = getAvailableWallets(config)
    metrics.walletsTotal.set(wallets.length)
    metrics.walletsAvailable.set(wallets.length)
    const logger = config.getLogger(
        { module: "redis-sender-manager" },
        {
            level: config.executorLogLevel || config.logLevel
        }
    )

    const redis = getRedis(config.redisEndpoint!)
    const redisQueueName = `${config.redisKeyPrefix}:${config.chainId}:sender-manager`
    const redisQueue = await createRedisQueue({
        redis,
        name: redisQueueName,
        entries: wallets.map((w) => w.address),
        logger
    })

    // Track active wallets for this instance
    const activeWallets = new Set<Account>()

    logger.info(
        `Created redis sender manager with queueName: ${redisQueueName}`
    )
    return {
        getAllWallets: () => [...wallets],
        getWallet: async () => {
            logger.trace("waiting for wallet ")

            let walletAddress: string | null = null

            while (!walletAddress) {
                walletAddress = await redisQueue.pop()
                await delay(100)
            }

            const wallet = wallets.find((w) => w.address === walletAddress)

            // should never happen
            if (!wallet) {
                throw new Error("wallet not found")
            }

            activeWallets.add(wallet)

            logger.trace(
                { executor: wallet.address },
                "got wallet from sender manager"
            )

            await redisQueue.llen().then((len) => {
                metrics.walletsAvailable.set(len)
            })

            return wallet
        },
        markWalletProcessed: async (wallet: Account) => {
            if (activeWallets.delete(wallet)) {
                await redisQueue.push(wallet.address)
                const len = await redisQueue.llen()
                metrics.walletsAvailable.set(len)
            } else {
                logger.warn(
                    { executor: wallet.address },
                    "Attempted to mark a wallet as processed that wasn't active"
                )
            }
        },
        getActiveWallets: () => {
            return [...activeWallets]
        }
    }
}
