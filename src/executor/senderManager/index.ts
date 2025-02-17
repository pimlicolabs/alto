import { Account } from "viem"
import { AltoConfig } from "../../createConfig"
import { createMemorySenderManager } from "./createMemorySenderManager"
import { Metrics } from "@alto/utils"
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

export type SenderManager = {
    getAllWallets: () => Account[]
    getWallet: () => Promise<Account>
    markWalletProcessed: (wallet: Account) => Promise<void>
    getActiveWallets: () => Account[]
}

export const getSenderManager = async ({
    config,
    metrics
}: { config: AltoConfig; metrics: Metrics }): Promise<SenderManager> => {
    if (config.redisSenderManagerUrl) {
        return await createRedisSenderManager({ config, metrics })
    }

    return createMemorySenderManager({ config, metrics })
}
