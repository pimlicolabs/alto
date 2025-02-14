import { Metrics } from "@alto/utils"
import { SenderManager, getAvailableWallets } from "."
import { AltoConfig } from "../../createConfig"
import { Semaphore } from "async-mutex"
import { Account } from "viem"

export const createMemorySenderManager = ({
    config,
    metrics
}: { config: AltoConfig; metrics: Metrics }): SenderManager => {
    const wallets = getAvailableWallets(config)
    const availableWallets = [...wallets]

    const semaphore: Semaphore = new Semaphore(availableWallets.length)
    const logger = config.getLogger(
        { module: "sender-manager" },
        { level: config.executorLogLevel || config.logLevel }
    )

    return {
        getAllWallets: () => [...wallets],
        getWallet: async () => {
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
        pushWallet: async (wallet: Account) => {
            if (!availableWallets.includes(wallet)) {
                availableWallets.push(wallet)
            }

            semaphore.release()
            logger.trace(
                { executor: wallet.address },
                "pushed wallet to sender manager"
            )

            metrics.walletsAvailable.set(availableWallets.length)
        }
    }
}
