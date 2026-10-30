import type { Logger, Metrics } from "@alto/utils"
import Redis from "ioredis"
import type { Account } from "viem"
import type { EntryPointVersion } from "viem/account-abstraction"
import type { WalletPool } from "."
import type { AltoConfig } from "../../createConfig"

// Lua script for atomic wallet registration.
// Only adds wallets to the available pool if they haven't been registered before.
//
// params:
// KEYS[1] = available set redis key
// KEYS[2] = registered set redis key
// ARGV = wallet addresses
const ADD_WALLETS_SCRIPT = `
local availableKey = KEYS[1]
local registeredKey = KEYS[2]
local addedWallets = {}

for i, wallet in ipairs(ARGV) do
    local isNew = redis.call('SADD', registeredKey, wallet)
    if isNew == 1 then
        redis.call('SADD', availableKey, wallet)
        table.insert(addedWallets, wallet)
    end
end

return addedWallets
`

// Uses two Redis Sets:
// - "available" set: wallets currently available for use (SPOP to acquire, SADD to release)
// - "registered" set: all wallets ever registered (prevents re-adding in-use wallets)
async function createRedisWalletPool({
    redis,
    config,
    logger,
    entries,
    version
}: {
    redis: Redis
    config: AltoConfig
    logger: Logger
    entries: string[]
    version: EntryPointVersion
}) {
    const keyPrefix = `${config.redisKeyPrefix}:${config.chainId}:wallet-pool:${version}`
    const availableKey = `${keyPrefix}:available`
    const registeredKey = `${keyPrefix}:registered`

    // Register all wallets atomically in a single call
    const addedWallets = (await redis.eval(
        ADD_WALLETS_SCRIPT,
        2, // number of keys (availableKey, registeredKey)
        availableKey,
        registeredKey,
        ...entries
    )) as string[]

    logger.info(
        { availableKey, registeredKey, addedWallets },
        "Created redis wallet pool"
    )

    return {
        size: () => redis.scard(availableKey),
        pop: () => redis.spop(availableKey),
        push: (entry: string) => redis.sadd(availableKey, entry)
    }
}

const delay = async (delay: number) => {
    await new Promise((resolve) => setTimeout(resolve, delay))
}

export const createRedisSenderManager = async ({
    config,
    metrics,
    redisEndpoint,
    wallets,
    version
}: {
    config: AltoConfig
    metrics: Metrics
    redisEndpoint: string
    wallets: Account[]
    version: EntryPointVersion
}): Promise<WalletPool> => {
    metrics.walletsTotal.set({ pool: version }, wallets.length)
    metrics.walletsAvailable.set({ pool: version }, wallets.length)
    const logger = config.getLogger(
        { module: "redis-sender-manager", pool: version },
        {
            level: config.executorLogLevel || config.logLevel
        }
    )

    const redis = new Redis(redisEndpoint)
    const walletPool = await createRedisWalletPool({
        redis,
        config,
        logger,
        entries: wallets.map((w) => w.address),
        version
    })

    // Track active wallets for this instance
    const activeWallets = new Set<Account>()

    const popWallet = async (): Promise<Account | undefined> => {
        const walletAddress = await walletPool.pop()
        if (!walletAddress) {
            return undefined
        }

        const wallet = wallets.find((w) => w.address === walletAddress)

        // Can happen during a rolling deploy when a newer instance
        // registered wallets this instance doesn't have a key for. Return it
        // so it isn't lost from the pool.
        if (!wallet) {
            await walletPool.push(walletAddress)
            logger.warn(
                { executor: walletAddress },
                "popped unknown wallet from pool, returning it"
            )
        }

        return wallet
    }

    const activateWallet = async (wallet: Account): Promise<Account> => {
        activeWallets.add(wallet)

        logger.trace(
            { executor: wallet.address },
            "got wallet from sender manager"
        )

        await walletPool.size().then((len) => {
            metrics.walletsAvailable.set({ pool: version }, len)
        })

        return wallet
    }
    return {
        getAllWallets: () => [...wallets],
        getWallet: async () => {
            logger.trace("waiting for wallet ")

            let wallet: Account | undefined

            while (!wallet) {
                wallet = await popWallet()

                // Pool empty or unknown wallet, small backoff then poll again
                if (!wallet) {
                    await delay(100)
                }
            }

            return await activateWallet(wallet)
        },
        tryGetWallet: async (timeoutMs) => {
            logger.trace({ timeoutMs }, "waiting for wallet ")

            const deadline = Date.now() + timeoutMs
            let wallet = await popWallet()

            while (!wallet && Date.now() < deadline) {
                await delay(Math.min(100, deadline - Date.now()))
                wallet = await popWallet()
            }

            return wallet ? await activateWallet(wallet) : undefined
        },
        markWalletProcessed: async (wallet: Account) => {
            if (activeWallets.delete(wallet)) {
                await walletPool.push(wallet.address)
                const len = await walletPool.size()
                metrics.walletsAvailable.set({ pool: version }, len)
            } else {
                logger.warn(
                    { executor: wallet.address },
                    "Attempted to mark a wallet as processed that wasn't active"
                )
            }
        },
        getActiveWallets: () => {
            return [...activeWallets]
        }
    }
}
