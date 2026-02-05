import type { Logger, Metrics } from "@alto/utils"
import Redis from "ioredis"
import type { Account } from "viem"
import { getAvailableWallets } from "."
import type { AltoConfig } from "../../createConfig"
import type { SenderManager } from "../senderManager"

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
    entries
}: {
    redis: Redis
    config: AltoConfig
    logger: Logger
    entries: string[]
}) {
    const keyPrefix = `${config.redisKeyPrefix}:${config.chainId}:wallet-pool`
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
    redisEndpoint
}: {
    config: AltoConfig
    metrics: Metrics
    redisEndpoint: string
}): Promise<SenderManager> => {
    const wallets = getAvailableWallets(config)
    metrics.walletsTotal.set(wallets.length)
    metrics.walletsAvailable.set(wallets.length)
    const logger = config.getLogger(
        { module: "redis-sender-manager" },
        {
            level: config.executorLogLevel || config.logLevel
        }
    )

    const redis = new Redis(redisEndpoint)
    const walletPool = await createRedisWalletPool({
        redis,
        config,
        logger,
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
                walletAddress = await walletPool.pop()
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

            await walletPool.size().then((len) => {
                metrics.walletsAvailable.set(len)
            })

            return wallet
        },
        markWalletProcessed: async (wallet: Account) => {
            if (activeWallets.delete(wallet)) {
                await walletPool.push(wallet.address)
                const len = await walletPool.size()
                metrics.walletsAvailable.set(len)
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
