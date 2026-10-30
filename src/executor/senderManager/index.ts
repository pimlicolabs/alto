import type { Metrics } from "@alto/utils"
import type { Account, Address } from "viem"
import type { EntryPointVersion } from "viem/account-abstraction"
import type { AltoConfig } from "../../createConfig"
import { createMemorySenderManager } from "./createMemorySenderManager"
import { createRedisSenderManager } from "./createRedisSenderManager"

// Each EntryPoint version is bundled by its own set of executors.
export type ExecutorPool = "v6" | "v7" | "v8" | "v9"

const EXECUTOR_POOLS: Record<EntryPointVersion, ExecutorPool> = {
    "0.6": "v6",
    "0.7": "v7",
    "0.8": "v8",
    "0.9": "v9"
}

export const getExecutorPrivateKeys = ({
    config,
    version
}: {
    config: AltoConfig
    version: EntryPointVersion
}): Account[] | undefined => {
    switch (version) {
        case "0.6":
            return config.v6ExecutorPrivateKeys
        case "0.7":
            return config.v7ExecutorPrivateKeys
        case "0.8":
            return config.v8ExecutorPrivateKeys
        case "0.9":
            return config.v9ExecutorPrivateKeys
    }
}

// Permissioned chains whitelist the executors, so simulations are sent
// from one of them.
export const getEthCallSender = ({
    config,
    version
}: {
    config: AltoConfig
    version: EntryPointVersion
}): Address | undefined =>
    getExecutorPrivateKeys({ config, version })?.[0]?.address

const getMaxExecutors = ({
    config,
    version
}: {
    config: AltoConfig
    version: EntryPointVersion
}): number | undefined => {
    switch (version) {
        case "0.6":
            return config.v6MaxExecutors
        case "0.7":
            return config.v7MaxExecutors
        case "0.8":
            return config.v8MaxExecutors
        case "0.9":
            return config.v9MaxExecutors
    }
}

const getPoolWallets = ({
    config,
    version
}: {
    config: AltoConfig
    version: EntryPointVersion
}): Account[] => {
    const privateKeys = getExecutorPrivateKeys({ config, version }) ?? []
    const maxExecutors = getMaxExecutors({ config, version })

    if (maxExecutors !== undefined && privateKeys.length > maxExecutors) {
        return privateKeys.slice(0, maxExecutors)
    }

    return privateKeys
}

// The wallets of a single executor pool.
export type WalletPool = {
    getAllWallets: () => Account[]
    getWallet: () => Promise<Account>
    // Like getWallet, but gives up and returns undefined if no wallet frees
    // up within timeoutMs.
    tryGetWallet: (timeoutMs: number) => Promise<Account | undefined>
    lockWallet?: (wallet: Account) => Promise<void>
    markWalletProcessed: (wallet: Account) => Promise<void>
    getActiveWallets: () => Account[]
}

export type SenderManager = {
    getAllWallets: () => Account[]
    getWallet: (version: EntryPointVersion) => Promise<Account>
    // Like getWallet, but gives up and returns undefined if no wallet frees
    // up within timeoutMs.
    tryGetWallet: (
        version: EntryPointVersion,
        timeoutMs: number
    ) => Promise<Account | undefined>
    lockWallet?: (wallet: Account) => Promise<void>
    markWalletProcessed: (wallet: Account) => Promise<void>
    getActiveWallets: () => Account[]
}

export const getSenderManager = async ({
    config,
    metrics
}: { config: AltoConfig; metrics: Metrics }): Promise<SenderManager> => {
    const createWalletPool = async (
        version: EntryPointVersion
    ): Promise<WalletPool | undefined> => {
        const wallets = getPoolWallets({ config, version })
        if (wallets.length === 0) {
            return undefined
        }

        const pool = EXECUTOR_POOLS[version]

        if (config.enableHorizontalScaling && config.redisEndpoint) {
            return await createRedisSenderManager({
                config,
                metrics,
                redisEndpoint: config.redisEndpoint,
                wallets,
                pool
            })
        }

        return createMemorySenderManager({ config, metrics, wallets, pool })
    }

    const versions = Object.keys(EXECUTOR_POOLS) as EntryPointVersion[]
    const walletPools = new Map<EntryPointVersion, WalletPool>()
    await Promise.all(
        versions.map(async (version) => {
            const walletPool = await createWalletPool(version)
            if (walletPool) {
                walletPools.set(version, walletPool)
            }
        })
    )
    const allWalletPools = [...walletPools.values()]

    const getWalletPool = (version: EntryPointVersion): WalletPool => {
        const walletPool = walletPools.get(version)
        if (!walletPool) {
            throw new Error(`No executors configured for EntryPoint ${version}`)
        }
        return walletPool
    }

    const findWalletPool = (wallet: Account): WalletPool | undefined =>
        allWalletPools.find((walletPool) =>
            walletPool.getAllWallets().some((w) => w.address === wallet.address)
        )

    const lockWallet = allWalletPools.every(
        (walletPool) => walletPool.lockWallet !== undefined
    )
        ? async (wallet: Account) => {
              await findWalletPool(wallet)?.lockWallet?.(wallet)
          }
        : undefined

    return {
        getAllWallets: () =>
            allWalletPools.flatMap((walletPool) => walletPool.getAllWallets()),
        getWallet: (version) => getWalletPool(version).getWallet(),
        tryGetWallet: (version, timeoutMs) =>
            getWalletPool(version).tryGetWallet(timeoutMs),
        lockWallet,
        markWalletProcessed: async (wallet) => {
            await findWalletPool(wallet)?.markWalletProcessed(wallet)
        },
        getActiveWallets: () =>
            allWalletPools.flatMap((walletPool) =>
                walletPool.getActiveWallets()
            )
    }
}
