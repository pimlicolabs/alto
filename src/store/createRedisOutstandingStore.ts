import { getNonceKeyAndSequence } from "../utils/userop"
import { AltoConfig } from "../createConfig"
import { UserOpInfo, userOpInfoSchema } from "../types/mempool"
import { HexData32, UserOperation } from "@alto/types"
import { OutstandingStore } from "."
import { Redis } from "ioredis"

const serializeUserOpInfo = (userOpInfo: UserOpInfo): string => {
    return JSON.stringify(userOpInfo, (_, value) =>
        typeof value === "bigint" ? value.toString() : value
    )
}

const deserializeUserOpInfo = (data: string): UserOpInfo => {
    const parsed = JSON.parse(data)
    return userOpInfoSchema.parse(parsed)
}

const createRedisKeys = (chainId: number) => {
    return {
        // Used to keep track of ops ready for bundling
        // - Sorted by gasPrice
        // - Only includes lowest nonce for every (sender, nonceKeyKey) pair
        // - Stores (sender, nonceKey) redis key
        readyOpsQueue: () => {
            return `${chainId}:outstanding:pending-queue`
        },

        // Used to keep track of pending ops by (sender, nonceKey) pair
        // - Each key stores a list of pending userOpInfo for that (sender, nonceKey) pair
        // - Sorted by nonceSeq
        pendingOps: (userOp: UserOperation) => {
            const sender = userOp.sender
            const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
            const fingerPrint = `${sender}-${nonceKey}`
            return `${chainId}:outstanding:pending-ops:${fingerPrint}`
        },

        // Used to keep track of active (sender, nonceKey) pair queue slots
        // - Used for easier cleanup + finding how many ops are pending (+dumping the entire outstanding store)
        pendingsOpsIndexList: () => {
            return `${chainId}:outstanding:slots`
        },

        // Secondary index to map userOpHash to pendingOpsKey (used for easy lookup when calling outstanding.remove())
        userOpHashLookup: () => {
            return `${chainId}:outstanding:user-op-hash-index`
        }
    }
}

export const createRedisOutstandingQueue = ({
    config
}: {
    config: AltoConfig
}): OutstandingStore => {
    const chainId = config.chainId

    const { redisMempoolUrl } = config
    if (!redisMempoolUrl) {
        throw new Error("missing required redisMempoolUrl")
    }

    const redisClient = new Redis(redisMempoolUrl)
    const redisKeys = createRedisKeys(chainId)

    // Adds userOp to queue and maintains sorting by gas price
    const addToReadyOpsQueue = async (userOpInfo: UserOpInfo) => {
        const { userOp } = userOpInfo
        const pendingOpsKey = redisKeys.pendingOps(userOp)

        await redisClient.zadd(
            redisKeys.readyOpsQueue(),
            Number(userOpInfo.userOp.maxFeePerGas), // Score
            pendingOpsKey
        )
    }

    const addToPendingOpsQueue = async (userOpInfo: UserOpInfo) => {
        const { userOp } = userOpInfo
        const [, nonceSeq] = getNonceKeyAndSequence(userOp.nonce)
        const pendingOpsKey = redisKeys.pendingOps(userOp)

        // Add to the (sender, nonceKey) queue with nonceSeq as score
        await redisClient.zadd(
            pendingOpsKey,
            Number(nonceSeq),
            serializeUserOpInfo(userOpInfo)
        )

        // Record (sender, nonceKey) index
        await redisClient.sadd(redisKeys.pendingsOpsIndexList(), pendingOpsKey)
    }

    // Returns sorted pending ops by nonceSeq for a given (sender, nonceKey) pair
    const getSortedPendingOps = async ({
        userOpInfo,
        pendingOpsKey
    }: {
        userOpInfo?: UserOpInfo
        pendingOpsKey?: string
    }): Promise<UserOpInfo[]> => {
        if (pendingOpsKey) {
            const zsetKey = pendingOpsKey
            const entries = await redisClient.zrange(zsetKey, 0, -1)
            return entries.map(deserializeUserOpInfo)
        }

        if (userOpInfo) {
            const { userOp } = userOpInfo
            const zsetKey = redisKeys.pendingOps(userOp)
            const entries = await redisClient.zrange(zsetKey, 0, -1)
            return entries.map(deserializeUserOpInfo)
        }

        throw new Error("missing required userOpInfo or pendingOpsKey")
    }

    // Add this helper function to maintain the secondary index
    const addToUserOpHashLookup = async (userOpInfo: UserOpInfo) => {
        const { userOpHash, userOp } = userOpInfo
        const pendingOpsKey = redisKeys.pendingOps(userOp)

        // Store mapping from userOpHash to pendingOpsKey and serialized userOpInfo
        await redisClient.hset(
            redisKeys.userOpHashLookup(),
            userOpHash,
            pendingOpsKey
        )
    }

    return {
        pop: async () => {
            // Pop highest score in readyOpsQueue
            const multi = redisClient.multi()
            multi.zrange(redisKeys.readyOpsQueue(), 0, 0)
            multi.zremrangebyrank(redisKeys.readyOpsQueue(), 0, 0)
            const results = await multi.exec()

            if (
                !results ||
                !results[0][1] ||
                (results[0][1] as string[])?.length === 0
            ) {
                return undefined
            }

            const userOpInfoStr = (results[0][1] as string[])[0]
            const userOpInfo = deserializeUserOpInfo(userOpInfoStr)

            await redisClient
                .multi()
                .zrem(redisKeys.pendingOps(userOpInfo.userOp), userOpInfoStr)
                .hdel(redisKeys.userOpHashLookup(), userOpInfo.userOpHash)
                .exec()

            // Get remaining operations for this slot
            const sortedOps = await getSortedPendingOps({ userOpInfo })

            // If there are more items, add the next one to the priority queue
            if (sortedOps.length > 0) {
                await addToReadyOpsQueue(sortedOps[0])
            } else {
                // If no more pending operations, cleanup by removing the (sender, nonceKey) list
                await redisClient
                    .multi()
                    .srem(
                        redisKeys.pendingsOpsIndexList(),
                        redisKeys.pendingOps(userOpInfo.userOp)
                    )
                    .del(redisKeys.pendingOps(userOpInfo.userOp))
                    .exec()
            }

            return userOpInfo
        },

        add: async (userOpInfo: UserOpInfo) => {
            const { userOpHash } = userOpInfo

            // Add to (sender, nonceKey) queue
            await addToPendingOpsQueue(userOpInfo)

            // Add to userOpHash index
            await addToUserOpHashLookup(userOpInfo)

            // If this is the lowest nonce for (sender, nonceKey) pair, update the priority queue
            const sortedOps = await getSortedPendingOps({ userOpInfo })
            if (
                sortedOps.length > 0 &&
                sortedOps[0].userOpHash === userOpHash
            ) {
                await addToReadyOpsQueue(userOpInfo)
            }
        },

        remove: async (userOpHash: HexData32) => {
            // Get the userOp info from the secondary index
            const pendingOpsKey = await redisClient.hget(
                redisKeys.userOpHashLookup(),
                userOpHash
            )

            if (!pendingOpsKey) {
                return false
            }

            // Check if we are removing the lowest userOp for the (sender, nonceKey) pair
            const sortedOps = await getSortedPendingOps({ pendingOpsKey })
            const userOpInfo = sortedOps.find(
                (sop) => sop.userOpHash === userOpHash
            )

            if (!userOpInfo) {
                return false
            }

            if (
                sortedOps.length > 0 &&
                sortedOps[0].userOpHash === userOpHash
            ) {
                // If this is the lowest userOp in (sender, nonceKey) pair, remove from readyOpsQueue, userOpHashLookup, pendingOpsList
                await redisClient
                    .multi()
                    .zrem(redisKeys.readyOpsQueue(), pendingOpsKey)
                    .hdel(redisKeys.userOpHashLookup(), userOpHash)
                    .zrem(pendingOpsKey, serializeUserOpInfo(userOpInfo))
                    .exec()

                sortedOps.shift()

                // If there are more operations, add the next lowest nonceSeq to readyOpsQueue
                if (sortedOps.length > 0) {
                    await addToReadyOpsQueue(sortedOps[0])
                }
            } else {
                // Otherwise, delete from userOpHashLookup and remove from pendingOpsList
                await redisClient
                    .multi()
                    .hdel(redisKeys.userOpHashLookup(), userOpHash)
                    .zrem(pendingOpsKey, serializeUserOpInfo(userOpInfo))
                    .exec()
            }

            return true
        },

        dump: async () => {
            // Get all slots
            const slots = await redisClient.smembers(
                redisKeys.pendingsOpsIndexList()
            )
            const allOps: UserOpInfo[] = []

            // For each slot, get all operations
            for (const slot of slots) {
                const zsetKey = slot
                const entries = await redisClient.zrange(zsetKey, 0, -1)

                if (entries && entries.length > 0) {
                    const ops = entries.map(deserializeUserOpInfo)
                    allOps.push(...ops)
                }
            }

            return allOps
        },

        clear: async () => {
            // Get all slots
            const slots = await redisClient.smembers(
                redisKeys.pendingsOpsIndexList()
            )

            const multi = redisClient.pipeline()
            for (const slot of slots) {
                multi.del(slot)
            }

            multi.del(redisKeys.pendingsOpsIndexList())
            multi.del(redisKeys.userOpHashLookup())
            multi.del(redisKeys.readyOpsQueue())

            await multi.exec()
        },

        length: async () => {
            // Count total number of operations across all slots
            const slots = await redisClient.smembers(
                redisKeys.pendingsOpsIndexList()
            )
            let totalCount = 0

            for (const slot of slots) {
                const count = await redisClient.zcard(slot)
                totalCount += Number(count)
            }

            return totalCount
        }
    }
}
