import type { Metrics } from "@alto/utils"
import Redis from "ioredis"
import type { Account } from "viem"
import { getAvailableWallets } from "."
import { getRedisKeys } from "../../cli/config/redisKeys"
import type { AltoConfig } from "../../createConfig"
import type { SenderManager } from "../senderManager"

async function createRedisQueue({
    redis,
    name,
    entries,
    logger
}: {
    redis: Redis
    name: string
    entries: string[]
    logger?: any
}) {
    const startTime = Date.now()
    const hasElements = await redis.llen(name)
    logger?.info(`[DEBUG - redis.llen] ${Date.now() - startTime}ms`)

    // Ensure queue is populated on startup
    // Avoids race case where queue is populated twice due to multi (atomic txs)
    if (hasElements === 0) {
        const multiStartTime = Date.now()
        const multi = redis.multi()
        multi.del(name)
        multi.rpush(name, ...entries)
        await multi.exec()
        logger?.info(`[DEBUG - redis.multiExec] ${Date.now() - multiStartTime}ms`)
    }

    return {
        llen: async () => {
            const startTime = Date.now()
            const result = await redis.llen(name)
            logger?.info(`[DEBUG - redis.llen] ${Date.now() - startTime}ms`)
            return result
        },
        pop: async () => {
            const startTime = Date.now()
            const result = await redis.rpop(name)
            logger?.info(`[DEBUG - redis.rpop] ${Date.now() - startTime}ms`)
            return result
        },
        push: async (entry: string) => {
            const startTime = Date.now()
            const result = await redis.lpush(name, entry)
            logger?.info(`[DEBUG - redis.lpush] ${Date.now() - startTime}ms`)
            return result
        }
    }
}

const delay = async (delay: number) => {
    await new Promise((resolve) => setTimeout(resolve, delay))
}

export const createRedisSenderManager = async ({
    config,
    metrics,
    redisEndpoint
}: {
    config: AltoConfig
    metrics: Metrics
    redisEndpoint: string
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

    const redis = new Redis(redisEndpoint)
    const redisQueueName = getRedisKeys(config).senderManagerQueue
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
            const startTime = Date.now()
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

            logger.info(`[DEBUG - redis.getWallet] ${Date.now() - startTime}ms`)
            return wallet
        },
        markWalletProcessed: async (wallet: Account) => {
            const startTime = Date.now()
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
            logger.info(`[DEBUG - redis.markWalletProcessed] ${Date.now() - startTime}ms`)
        },
        getActiveWallets: () => {
            return [...activeWallets]
        }
    }
}
