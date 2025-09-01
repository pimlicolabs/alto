import type { Metrics } from "@alto/utils"
import type { Account } from "viem"
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

export type SenderManager = {
    getAllWallets: () => Account[]
    getWallet: () => Promise<Account>
    lockWallet?: (wallet: Account) => Promise<void>
    markWalletProcessed: (wallet: Account) => Promise<void>
    getActiveWallets: () => Account[]
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
