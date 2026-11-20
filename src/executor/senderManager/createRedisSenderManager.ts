import type { Logger, Metrics } from "@alto/utils"
import Redis from "ioredis"
import type { Account, Address } from "viem"
import type { EntryPointVersion } from "viem/account-abstraction"
import type { WalletPool } from "."
import type { AltoConfig } from "../../createConfig"

// A checked-out wallet holds a lease in the leases sorted set
// (score = expiry in ms). The holder refreshes it while it holds the wallet,
// so a wallet whose lease expired was left behind by an instance that died.
const LEASE_TTL_MS = 60_000
const LEASE_REFRESH_INTERVAL_MS = 15_000
// How often leaked wallets are looked for. A wallet is only reclaimed once
// two consecutive sweeps found it leaked with the same onchain nonce.
const RECLAIM_INTERVAL_MS = 60_000

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

// Pops a wallet and leases it in one step, so a checked-out wallet always
// has a lease.
//
// KEYS[1] = available set, KEYS[2] = leases sorted set
// ARGV[1] = lease expiry (ms)
const POP_WALLET_SCRIPT = `
local wallet = redis.call('SPOP', KEYS[1])
if wallet then
    redis.call('ZADD', KEYS[2], ARGV[1], wallet)
end
return wallet
`

// Drops the lease and returns the wallet to the available set in one step.
//
// KEYS[1] = available set, KEYS[2] = leases sorted set
// ARGV[1] = wallet address
const PUSH_WALLET_SCRIPT = `
redis.call('ZREM', KEYS[2], ARGV[1])
return redis.call('SADD', KEYS[1], ARGV[1])
`

// Finds leaked wallets: registered, not available and without a live lease,
// so no instance holds them. With ARGV[2] == '1' it also returns them to the
// available set. The checks and the SADD run atomically, so a wallet that was
// popped or returned since the caller last looked is left alone.
//
// KEYS[1] = available set, KEYS[2] = registered set, KEYS[3] = leases sorted set
// ARGV[1] = now (ms), ARGV[2] = '1' to reclaim, ARGV[3..] = wallet addresses
const LEAKED_WALLETS_SCRIPT = `
local now = tonumber(ARGV[1])
local reclaim = ARGV[2] == '1'
local leaked = {}

for i = 3, #ARGV do
    local wallet = ARGV[i]
    if redis.call('SISMEMBER', KEYS[2], wallet) == 1
        and redis.call('SISMEMBER', KEYS[1], wallet) == 0 then
        local expiry = redis.call('ZSCORE', KEYS[3], wallet)
        if not expiry or tonumber(expiry) <= now then
            if reclaim then
                redis.call('ZREM', KEYS[3], wallet)
                redis.call('SADD', KEYS[1], wallet)
            end
            table.insert(leaked, wallet)
        end
    end
end

return leaked
`

// Uses two Redis Sets and a Sorted Set:
// - "available" set: wallets currently available for use (SPOP to acquire, SADD to release)
// - "registered" set: all wallets ever registered (prevents re-adding in-use wallets)
// - "leases" sorted set: checked-out wallets, scored by lease expiry
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
    const leasesKey = `${keyPrefix}:leases`

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

    const leakedWallets = async ({
        wallets,
        reclaim
    }: { wallets: string[]; reclaim: boolean }): Promise<string[]> => {
        if (wallets.length === 0) {
            return []
        }
        return (await redis.eval(
            LEAKED_WALLETS_SCRIPT,
            3,
            availableKey,
            registeredKey,
            leasesKey,
            Date.now(),
            reclaim ? "1" : "0",
            ...wallets
        )) as string[]
    }

    return {
        size: () => redis.scard(availableKey),
        pop: async () =>
            (await redis.eval(
                POP_WALLET_SCRIPT,
                2,
                availableKey,
                leasesKey,
                Date.now() + LEASE_TTL_MS
            )) as string | null,
        push: (entry: string) =>
            redis.eval(PUSH_WALLET_SCRIPT, 2, availableKey, leasesKey, entry),
        refreshLeases: async (wallets: string[]) => {
            if (wallets.length === 0) {
                return
            }
            const expiry = Date.now() + LEASE_TTL_MS
            await redis.zadd(
                leasesKey,
                ...wallets.flatMap((wallet) => [expiry, wallet])
            )
        },
        findLeaked: (wallets: string[]) =>
            leakedWallets({ wallets, reclaim: false }),
        reclaim: (wallets: string[]) =>
            leakedWallets({ wallets, reclaim: true })
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
    metrics.walletsTotal.set({ entrypoint_version: version }, wallets.length)
    metrics.walletsAvailable.set(
        { entrypoint_version: version },
        wallets.length
    )
    const logger = config.getLogger(
        { module: "redis-sender-manager", entryPointVersion: version },
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

    // Keep the leases of the wallets this instance holds alive.
    setInterval(() => {
        walletPool
            .refreshLeases([...activeWallets].map((w) => w.address))
            .catch((err) => {
                logger.error({ err }, "failed to refresh wallet leases")
            })
    }, LEASE_REFRESH_INTERVAL_MS).unref()

    // A wallet that was checked out when its instance died (crash, kill,
    // failed shutdown) is never returned, and the registered set stops it
    // from being added again on the next start, so the pool shrinks.
    //
    // Such a wallet is not available and has no live lease. It is returned
    // once it has no pending transaction and two consecutive sweeps saw it
    // leaked with the same nonce, so the transaction of the instance that
    // died has landed or been dropped and nobody sent from it in between.
    // The reclaim script checks again atomically that it is still not
    // available and has no live lease before returning it.
    let leakedNonces = new Map<string, number>()
    let isReclaiming = false
    const reclaimLeakedWallets = async () => {
        if (isReclaiming) {
            return
        }
        isReclaiming = true
        try {
            const leaked = await walletPool.findLeaked(
                wallets.map((w) => w.address)
            )

            const nextLeakedNonces = new Map<string, number>()
            const toReclaim: string[] = []
            await Promise.all(
                leaked.map(async (address) => {
                    const [latest, pending] = await Promise.all([
                        config.publicClient.getTransactionCount({
                            address: address as Address,
                            blockTag: "latest"
                        }),
                        config.publicClient.getTransactionCount({
                            address: address as Address,
                            blockTag: "pending"
                        })
                    ])
                    if (latest !== pending) {
                        logger.info(
                            { executor: address, latest, pending },
                            "leaked wallet has a pending transaction, not reclaiming yet"
                        )
                        return
                    }
                    if (leakedNonces.get(address) === latest) {
                        toReclaim.push(address)
                    } else {
                        nextLeakedNonces.set(address, latest)
                    }
                })
            )
            leakedNonces = nextLeakedNonces

            const reclaimed = await walletPool.reclaim(toReclaim)
            if (reclaimed.length > 0) {
                logger.warn(
                    { executors: reclaimed },
                    "reclaimed leaked wallets into the pool"
                )
                metrics.walletsAvailable.set(
                    { entrypoint_version: version },
                    await walletPool.size()
                )
            }
        } catch (err) {
            logger.error({ err }, "failed to reclaim leaked wallets")
        } finally {
            isReclaiming = false
        }
    }
    reclaimLeakedWallets()
    setInterval(reclaimLeakedWallets, RECLAIM_INTERVAL_MS).unref()

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
            metrics.walletsAvailable.set({ entrypoint_version: version }, len)
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
                metrics.walletsAvailable.set(
                    { entrypoint_version: version },
                    len
                )
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
