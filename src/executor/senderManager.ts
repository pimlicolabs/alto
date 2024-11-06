import type { Metrics } from "@alto/utils"
import { Semaphore } from "async-mutex"
import type { Account } from "viem"
import type { AltoConfig } from "@alto/config"
import { Semaphore as RedisSemaphore } from "redis-semaphore"
import { Redis } from "ioredis"

export type SenderManager = {
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

export const createSenderManager = ({
    config,
    metrics
}: {
    config: AltoConfig
    metrics: Metrics
}): SenderManager => {
    const wallets = getAvailableWallets(config)
    const availableWallets = [...wallets]

    let semaphore: Semaphore | RedisSemaphore

    if (config.redisQueueEndpoint) {
        const redis = new Redis(config.redisQueueEndpoint)
        semaphore = new RedisSemaphore(
            redis,
            "sender-manager",
            availableWallets.length
        )
    } else {
        semaphore = new Semaphore(availableWallets.length)
    }

    const logger = config.getLogger(
        { module: "sender-manager" },
        {
            level: config.executorLogLevel || config.logLevel
        }
    )

    return {
        getAllWallets: () => [...wallets],
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
