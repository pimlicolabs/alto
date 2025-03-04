import { getNonceKeyAndSequence } from "../utils/userop"
import { AltoConfig } from "../createConfig"
import {
    Address,
    HexData32,
    UserOperation,
    UserOpInfo,
    userOpInfoSchema
} from "@alto/types"
import { OutstandingStore } from "."
import { Redis } from "ioredis"
import { toHex } from "viem/utils"

const serializeUserOpInfo = (userOpInfo: UserOpInfo): string => {
    return JSON.stringify(userOpInfo, (_, value) =>
        typeof value === "bigint" ? toHex(value) : value
    )
}

const deserializeUserOpInfo = (data: string): UserOpInfo => {
    try {
        const parsed = JSON.parse(data)
        const result = userOpInfoSchema.safeParse(parsed)

        if (!result.success) {
            throw new Error(
                `Failed to parse UserOpInfo: ${result.error.message}`
            )
        }
        return result.data
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(
                `UserOpInfo deserialization failed: ${error.message}`
            )
        }
        throw new Error("UserOpInfo deserialization failed with unknown error")
    }
}

const createRedisKeys = (chainId: number, entryPoint: Address) => {
    return {
        // Used to keep track of ops ready for bundling
        // - Sorted by gasPrice
        // - Only includes lowest nonce for every (sender, nonceKey) pair
        // - Stores (sender, nonceKey) redis key
        readyOpsQueue: () => {
            return `${chainId}:outstanding:pending-queue:${entryPoint}`
        },

        // Used to keep track of pending ops by (sender, nonceKey) pair
        // - Each key stores a list of pending userOpInfo for that (sender, nonceKey) pair
        // - Sorted by nonceSeq
        pendingOps: (userOp: UserOperation) => {
            const sender = userOp.sender
            const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
            const fingerPrint = `${sender}-${toHex(nonceKey)}`
            return `${chainId}:outstanding:pending-ops:${entryPoint}:${fingerPrint}`
        },

        // Secondary index to map userOpHash to pendingOpsKey (used for easy lookup when calling outstanding.remove())
        userOpHashLookup: () => {
            return `${chainId}:outstanding:user-op-hash-index:${entryPoint}`
        }
    }
}

export const createRedisOutstandingQueue = ({
    config,
    entryPoint
}: {
    config: AltoConfig
    entryPoint: Address
}): OutstandingStore => {
    const chainId = config.chainId

    const { redisMempoolUrl } = config
    if (!redisMempoolUrl) {
        throw new Error("missing required redisMempoolUrl")
    }

    const redisClient = new Redis(redisMempoolUrl, {})
    const redisKeys = createRedisKeys(chainId, entryPoint)

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

    // Returns sorted pending ops by nonceSeq for a given (sender, nonceKey) pair
    const getSortedPendingOps = async ({
        userOpInfo,
        pendingOpsKey
    }: {
        userOpInfo?: UserOpInfo
        pendingOpsKey?: string
    }): Promise<UserOpInfo[]> => {
        let zsetKey: string

        if (pendingOpsKey) {
            zsetKey = pendingOpsKey
        } else if (userOpInfo) {
            const { userOp } = userOpInfo
            zsetKey = redisKeys.pendingOps(userOp)
        } else {
            throw new Error("missing required userOpInfo or pendingOpsKey")
        }

        const entries = await redisClient.zrange(zsetKey, 0, -1)
        return entries.map(deserializeUserOpInfo)
    }

    return {
        validateQueuedLimit: (_: UserOperation) => {
            return true
        },
        validateParallelLimit: (_: UserOperation) => {
            return true
        },
        findConflicting: async (userOpInfo: UserOpInfo) => {
            throw new Error("Method not implemented.")
        },
        contains: async (userOpHash: HexData32) => {
            const pendingOpsKey = await redisClient.hget(
                redisKeys.userOpHashLookup(),
                userOpHash
            )

            if (!pendingOpsKey) {
                return false
            }

            return true
        },
        peek: async () => {
            // Get the highest from readyOpsQueue without removing it
            const pendingOpsKeys = await redisClient.zrange(
                redisKeys.readyOpsQueue(),
                0,
                0
            )

            if (!pendingOpsKeys || pendingOpsKeys.length === 0) {
                return undefined
            }

            const pendingOpsKey = pendingOpsKeys[0]

            // Get the lowest nonce operation from the pendingOpsKey
            const userOpInfoStrings = await redisClient.zrange(
                pendingOpsKey,
                0,
                0
            )

            if (!userOpInfoStrings || userOpInfoStrings.length === 0) {
                return undefined
            }

            return deserializeUserOpInfo(userOpInfoStrings[0])
        },
        pop: async () => {
            type ZmpopResult = [string, [string, string][]] // stored as [key, [value, score]]

            // Pop element with highest score in readyOpsQueue.
            const bestGasPrice = (await redisClient.zmpop(
                1,
                [redisKeys.readyOpsQueue()],
                "MAX"
            )) as ZmpopResult

            const pendingOpsKey =
                bestGasPrice && bestGasPrice[1].length > 0
                    ? bestGasPrice[1][0][0]
                    : undefined

            if (!pendingOpsKey) {
                return undefined
            }

            // Get the next two userOp with lowest nonce for sender+nonceKey.
            // Lowest userOp will be returned first (and perform redis clean up)
            // Second lowest userOp will be added to the priority queue
            const lowest = (await redisClient.zmpop(
                1,
                [redisKeys.readyOpsQueue()],
                "MIN",
                "COUNT",
                2
            )) as ZmpopResult

            const currentUserOpStr =
                lowest[1].length > 0 ? lowest[1][0][0] : undefined
            const nextUserOpStr =
                lowest[1].length > 1 ? lowest[1][1][0] : undefined

            if (!currentUserOpStr) {
                return undefined
            }

            const currentUserOp = deserializeUserOpInfo(currentUserOpStr)
            const multi = redisClient.multi()

            if (currentUserOpStr) {
                multi.zrem(pendingOpsKey, currentUserOpStr)
                multi.hdel(
                    redisKeys.userOpHashLookup(),
                    currentUserOp.userOpHash
                )
            }

            // Add next lowest nonce to readyOpsQueue
            if (nextUserOpStr) {
                const nextUserOp = deserializeUserOpInfo(nextUserOpStr)
                multi.zadd(
                    redisKeys.readyOpsQueue(),
                    Number(nextUserOp.userOp.maxFeePerGas),
                    pendingOpsKey
                )
            } else {
                // cleanup if there are no more pending operations
                multi.del(pendingOpsKey)
            }

            await multi.exec()
            return currentUserOp
        },

        add: async (userOpInfo: UserOpInfo) => {
            const { userOpHash, userOp } = userOpInfo

            // Check if is lowest
            const entries = await redisClient.zrange(
                redisKeys.pendingOps(userOp),
                0,
                -1
            )
            const sortedUserOps = entries.map(deserializeUserOpInfo)
            const isLowestNonceSeq = sortedUserOps[0]?.userOpHash === userOpHash

            const multi = redisClient.multi()

            // Add to pendingOps queue with nonceSeq as score
            multi.zadd(
                redisKeys.pendingOps(userOp),
                Number(getNonceKeyAndSequence(userOp.nonce)[1]),
                serializeUserOpInfo(userOpInfo)
            )

            // Add to userOpHash lookup
            multi.hset(
                redisKeys.userOpHashLookup(),
                userOpHash,
                redisKeys.pendingOps(userOp)
            )

            // If this is the lowest nonce for (sender, nonceKey) pair, add to readyOpsQueue
            if (isLowestNonceSeq) {
                multi.zadd(
                    redisKeys.readyOpsQueue(),
                    Number(userOpInfo.userOp.maxFeePerGas), // Score
                    redisKeys.pendingOps(userOp)
                )
            }

            await multi.exec()
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
            throw new Error("TODO: delete me")
        },

        clear: async () => {
            // clear is only used for debug_bundler_clearState
            throw new Error("Not implemented")
        },

        length: async () => {
            // not needed as we aren't dumping redis mempool
            throw new Error("Not implemented")
        }
    }
}
