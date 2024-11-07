import type { Metrics } from "@alto/utils"
import { Semaphore } from "async-mutex"
import type { Account } from "viem"
import type { AltoConfig } from "@alto/config"
import { Redis } from "ioredis"

export type SenderManager = {
    getWalletsInUse: () => Account[]
    getAllWallets: () => Account[]
    getWallet: () => Promise<Account>
    pushWallet: (wallet: Account) => void
}

export const getAvailableWallets = (config: AltoConfig) => {
    let availableWallets: Account[] = []

    if (
        config.maxExecutors !== undefined &&
        config.executorPrivateKeys.length > config.maxExecutors
    ) {
        availableWallets = config.executorPrivateKeys.slice(
            0,
            config.maxExecutors
        )
    } else {
        availableWallets = config.executorPrivateKeys
    }

    return availableWallets
}

const createLocalSenderManager = ({
    config,
    metrics
}: {
    config: AltoConfig
    metrics: Metrics
}): SenderManager => {
    const wallets = getAvailableWallets(config)
    const availableWallets = [...wallets]

    const semaphore: Semaphore = new Semaphore(availableWallets.length)

    const logger = config.getLogger(
        { module: "sender-manager" },
        {
            level: config.executorLogLevel || config.logLevel
        }
    )

    return {
        getAllWallets: () => [...wallets],
        getWalletsInUse: () => [...availableWallets],
        async getWallet() {
            logger.trace("waiting for semaphore ")
            await semaphore.acquire()

            const wallet = availableWallets.shift()

            // should never happen because of semaphore
            if (!wallet) {
                semaphore.release()
                logger.error("no more wallets")
                throw new Error("no more wallets")
            }

            logger.trace(
                { executor: wallet.address },
                "got wallet from sender manager"
            )

            metrics.walletsAvailable.set(availableWallets.length)

            return wallet
        },
        pushWallet(wallet: Account) {
            if (!availableWallets.includes(wallet)) {
                availableWallets.push(wallet)
            }

            semaphore.release()
            logger.trace(
                { executor: wallet.address },
                "pushed wallet to sender manager"
            )

            metrics.walletsAvailable.set(availableWallets.length)
            return
        }
    }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

    if (hasElements === 0) {
        const pipeline = redis.pipeline()
        pipeline.del(name)
        pipeline.lpush(name, ...entries)
        await pipeline.exec()
    }

    return {
        llen: () => redis.llen(name),
        pop: () => redis.rpop(name),
        push: (entry: string) => redis.rpush(name, entry)
    }
}

const createRedisSenderManager = async ({
    config,
    metrics
}: {
    config: AltoConfig
    metrics: Metrics
}): Promise<SenderManager> => {
    if (!config.redisQueueEndpoint) {
        throw new Error("redisQueueEndpoint is required")
    }

    const wallets = getAvailableWallets(config)
    const walletsInUse: Record<string, Account> = {}

    const logger = config.getLogger(
        { module: "sender-manager" },
        {
            level: config.executorLogLevel || config.logLevel
        }
    )

    const redis = new Redis(config.redisQueueEndpoint)
    const redisQueue = await createRedisQueue({
        redis,
        name: `sender-manager-${config.publicClient.chain.id}`,
        entries: wallets.map((w) => w.address)
    })

    return {
        getAllWallets: () => [...wallets],
        getWalletsInUse: () => Object.values(walletsInUse),
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

            logger.trace(
                { executor: wallet.address },
                "got wallet from sender manager"
            )

            redisQueue.llen().then((len) => {
                metrics.walletsAvailable.set(len)
            })
            walletsInUse[wallet.address] = wallet

            return wallet
        },
        pushWallet: (wallet: Account) => {
            redisQueue.push(wallet.address).then(() => {
                redisQueue.llen().then((len) => {
                    metrics.walletsAvailable.set(len)
                })
            })

            if (walletsInUse[wallet.address]) {
                delete walletsInUse[wallet.address]
            }
        }
    }
}

export const createSenderManager = ({
    config,
    metrics
}: {
    config: AltoConfig
    metrics: Metrics
}): Promise<SenderManager> => {
    if (config.redisQueueEndpoint) {
        return createRedisSenderManager({
            config,
            metrics
        })
    }

    return Promise.resolve(
        createLocalSenderManager({
            config,
            metrics
        })
    )
}
