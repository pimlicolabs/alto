import { Metrics } from "@alto/utils"
import { AltoConfig } from "../../createConfig"
import { SenderManager } from "../senderManager"
import { getAvailableWallets } from "."
import { Account } from "viem"
import Redis from "ioredis"

async function createRedisQueue({
    redis,
    name,
    entries
}: {
    redis: Redis
    name: string
    entries: string[]
}) {
    const hasElements = await redis.llen(name)

    // Ensure queue is populated on startup
    // Avoids race case where queue is populated twice due to multi (atomic txs)
    if (hasElements === 0) {
        const multi = redis.multi()
        multi.del(name)
        multi.rpush(name, ...entries)
        await multi.exec()
    }

    return {
        llen: () => redis.llen(name),
        pop: () => redis.rpop(name),
        push: (entry: string) => redis.lpush(name, entry)
    }
}

const delay = async (delay: number) => {
    await new Promise((resolve) => setTimeout(resolve, delay))
}

export const createRedisSenderManager = async ({
    config,
    metrics
}: { config: AltoConfig; metrics: Metrics }): Promise<SenderManager> => {
    if (!config.redisMempoolUrl) {
        throw new Error("redisMempoolUrl is required")
    }

    const wallets = getAvailableWallets(config)
    const logger = config.getLogger(
        { module: "redis-sender-manager" },
        {
            level: config.executorLogLevel || config.logLevel
        }
    )

    const redis = new Redis(config.redisMempoolUrl)
    const redisQueueName = `${config.chainId}:${config.redisSenderManagerQueueName}`
    const redisQueue = await createRedisQueue({
        redis,
        name: redisQueueName,
        entries: wallets.map((w) => w.address)
    })

    // Track active wallets for this instance
    const activeWallets = new Set<Account>()

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

            redisQueue.llen().then((len) => {
                metrics.walletsAvailable.set(len)
            })

            return wallet
        },
        markWalletProcessed: async (wallet: Account) => {
            activeWallets.delete(wallet)

            redisQueue.push(wallet.address).then(() => {
                redisQueue.llen().then((len) => {
                    metrics.walletsAvailable.set(len)
                })
            })
        },
        getActiveWallets: () => {
            return [...activeWallets]
        }
    }
}
