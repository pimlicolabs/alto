import type { Metrics } from "@alto/utils"
import type { Account, Address } from "viem"
import type { AltoConfig } from "../../createConfig"
import { createMemorySenderManager } from "./createMemorySenderManager"
import { createRedisSenderManager } from "./createRedisSenderManager"

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

// Besides leasing wallets, the sender manager keeps each wallet's next nonce
// when it is known, so bundles don't have to read it from the chain. The
// nonce is handed over with the lease: it is loaded by getWallet and stored
// by markWalletProcessed, so it lives wherever the lease lives (in memory, or
// in Redis with horizontal scaling).
export type SenderManager = {
    getAllWallets: () => Account[]
    getWallet: () => Promise<Account>
    lockWallet?: (wallet: Account) => Promise<void>
    markWalletProcessed: (wallet: Account) => Promise<void>
    getActiveWallets: () => Account[]
    // Next nonce of a wallet leased with getWallet, or undefined when it has
    // to be read from the chain.
    getNextNonce: (wallet: Account) => number | undefined
    // Records the next nonce of a leased wallet, undefined forgets it.
    setNextNonce: (wallet: Account, nonce: number | undefined) => void
    // Forgets the next nonce of a wallet whether it is leased or not, for
    // when it may have moved without the leaseholder knowing (e.g. a reorg).
    invalidateNextNonce: (address: Address) => Promise<void>
}

export const getSenderManager = async ({
    config,
    metrics
}: { config: AltoConfig; metrics: Metrics }): Promise<SenderManager> => {
    if (config.enableHorizontalScaling && config.redisEndpoint) {
        return await createRedisSenderManager({
            config,
            metrics,
            redisEndpoint: config.redisEndpoint
        })
    }

    return createMemorySenderManager({ config, metrics })
}
