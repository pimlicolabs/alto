import type { Metrics } from "@alto/utils"
import { E_TIMEOUT, Semaphore, withTimeout } from "async-mutex"
import type { Account } from "viem"
import type { ExecutorPool, WalletPool } from "."
import type { AltoConfig } from "../../createConfig"

export const createMemorySenderManager = ({
    config,
    metrics,
    wallets,
    pool
}: {
    config: AltoConfig
    metrics: Metrics
    wallets: Account[]
    pool: ExecutorPool
}): WalletPool => {
    const availableWallets = [...wallets]

    const semaphore: Semaphore = new Semaphore(availableWallets.length)
    const logger = config.getLogger(
        { module: "sender-manager", pool },
        { level: config.executorLogLevel || config.logLevel }
    )

    metrics.walletsTotal.set({ pool }, wallets.length)
    metrics.walletsAvailable.set({ pool }, wallets.length)

    // Call after acquiring the semaphore.
    const takeWallet = (): Account => {
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

        metrics.walletsAvailable.set({ pool }, availableWallets.length)

        return wallet
    }

    logger.info("Created memory sender manager")
    return {
        getAllWallets: () => [...wallets],
        getWallet: async () => {
            logger.trace("waiting for semaphore ")
            await semaphore.acquire()
            return takeWallet()
        },
        tryGetWallet: async (timeoutMs) => {
            logger.trace({ timeoutMs }, "waiting for semaphore ")
            try {
                // A permit acquired after the timeout is released again.
                await withTimeout(semaphore, timeoutMs).acquire()
            } catch (err) {
                if (err === E_TIMEOUT) {
                    return undefined
                }
                throw err
            }
            return takeWallet()
        },
        lockWallet: async (wallet) => {
            logger.trace("waiting for semaphore ")
            await semaphore.acquire()

            const walletIndex = availableWallets.findIndex(
                (w) => w.address === wallet.address
            )

            if (walletIndex === -1) {
                semaphore.release()
                logger.error(
                    "wallet not found in available wallets or is already been used up"
                )
                return
            }

            availableWallets.splice(walletIndex, 1)

            logger.trace(
                { executor: wallet.address },
                "locked wallet in sender manager"
            )

            metrics.walletsAvailable.set({ pool }, availableWallets.length)
        },
        markWalletProcessed: async (wallet: Account) => {
            if (!availableWallets.some((w) => w.address === wallet.address)) {
                availableWallets.push(wallet)
                semaphore.release()
                logger.trace(
                    { executor: wallet.address },
                    "pushed wallet to sender manager"
                )
            }

            metrics.walletsAvailable.set({ pool }, availableWallets.length)
        },
        getActiveWallets: () => {
            // Active wallets are those that are in the total pool but not in the available pool
            return wallets.filter(
                (wallet) =>
                    !availableWallets.some(
                        (available) => available.address === wallet.address
                    )
            )
        }
    }
}
