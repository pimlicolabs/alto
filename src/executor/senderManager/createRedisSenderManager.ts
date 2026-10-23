import type { Logger, Metrics } from "@alto/utils"
import Redis from "ioredis"
import type { Account, Address } from "viem"
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

// Lua script to acquire a wallet: pops it from the available set together
// with the next nonce stored when it was released. The nonce is removed so
// it is only ever handed to one leaseholder.
//
// params:
// KEYS[1] = available set redis key
// KEYS[2] = next nonce hash redis key
const POP_WALLET_SCRIPT = `
local wallet = redis.call('SPOP', KEYS[1])
if not wallet then
    return false
end

local nonce = redis.call('HGET', KEYS[2], wallet)
redis.call('HDEL', KEYS[2], wallet)

return {wallet, nonce}
`

const parseNonce = (value: unknown): number | undefined => {
    if (typeof value !== "string") {
        return undefined
    }
    const nonce = Number(value)
    return Number.isSafeInteger(nonce) && nonce >= 0 ? nonce : undefined
}

// Uses two Redis Sets:
// - "available" set: wallets currently available for use (SPOP to acquire, SADD to release)
// - "registered" set: all wallets ever registered (prevents re-adding in-use wallets)
// And a hash of the next nonce of available wallets, written when a wallet
// is released and taken when it is acquired, so the nonce moves between
// instances with the wallet.
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
    const nextNonceKey = `${keyPrefix}:next-nonce`

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
        pop: async (): Promise<
            { address: string; nextNonce: number | undefined } | undefined
        > => {
            const result = (await redis.eval(
                POP_WALLET_SCRIPT,
                2,
                availableKey,
                nextNonceKey
            )) as [string, string | null] | null

            if (!result) {
                return undefined
            }

            const [address, nonce] = result
            return { address, nextNonce: parseNonce(nonce) }
        },
        // Stores the nonce (or clears a stale one) and releases the wallet
        // atomically, so whoever acquires it next sees the nonce.
        push: async ({
            address,
            nextNonce
        }: {
            address: string
            nextNonce: number | undefined
        }) => {
            const transaction = redis.multi()
            if (nextNonce === undefined) {
                transaction.hdel(nextNonceKey, address)
            } else {
                transaction.hset(nextNonceKey, address, nextNonce.toString())
            }
            await transaction.sadd(availableKey, address).exec()
        },
        clearNextNonce: (address: string) => redis.hdel(nextNonceKey, address)
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
    // Next nonce of the wallets leased by this instance.
    const nextNonces = new Map<Address, number>()
    return {
        getAllWallets: () => [...wallets],
        getWallet: async () => {
            logger.trace("waiting for wallet ")

            let wallet: Account | undefined

            while (!wallet) {
                const popped = await walletPool.pop()

                if (popped) {
                    wallet = wallets.find((w) => w.address === popped.address)

                    // Can happen during a rolling deploy when a newer
                    // instance registered wallets this instance doesn't
                    // have a key for. Return it so it isn't lost from the
                    // pool and keep waiting for a wallet we can use.
                    if (!wallet) {
                        await walletPool.push(popped)
                        logger.warn(
                            { executor: popped.address },
                            "popped unknown wallet from pool, returning it"
                        )
                    } else if (popped.nextNonce === undefined) {
                        nextNonces.delete(wallet.address)
                    } else {
                        nextNonces.set(wallet.address, popped.nextNonce)
                    }
                }

                // Pool empty or unknown wallet, small backoff then poll again
                if (!wallet) {
                    await delay(100)
                }
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
                const nextNonce = nextNonces.get(wallet.address)
                nextNonces.delete(wallet.address)
                await walletPool.push({ address: wallet.address, nextNonce })
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
        },
        getNextNonce: (wallet) => nextNonces.get(wallet.address),
        setNextNonce: ({ wallet, nonce }) => {
            // Only the leaseholder may change the nonce, it is stored on
            // release.
            if (!activeWallets.has(wallet)) {
                logger.warn(
                    { executor: wallet.address },
                    "Attempted to set the nonce of a wallet that isn't active"
                )
                return
            }
            nextNonces.set(wallet.address, nonce)
        },
        clearNextNonce: async (address) => {
            nextNonces.delete(address)
            // A leased wallet's nonce was taken from the pool with the lease,
            // so it is only known here.
            const isLeased = [...activeWallets].some(
                (wallet) => wallet.address === address
            )
            if (isLeased) {
                return
            }
            // Clears the nonce stored for the wallet if it is in the pool. If
            // another instance holds it, it took the nonce with the lease and
            // stores a fresh one on release.
            await walletPool.clearNextNonce(address)
        }
    }
}
