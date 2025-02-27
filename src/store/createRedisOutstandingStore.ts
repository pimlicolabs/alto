import { getNonceKeyAndSequence } from "../utils/userop"
import { AltoConfig } from "../createConfig"
import { UserOpInfo, userOpInfoSchema } from "../types/mempool"
import { HexData32, UserOperation } from "@alto/types"
import { OutstandingStore } from "."
import { Redis } from "ioredis"

// Structure
// - zset priority queue to hold outstanding userOps (scored by gasPrice and stores only sender:nonceKeyKey index)
// - redis list to store pending userOps by sender

// Used to keep track of ops ready for bundling (sorted by gasPrice, and includes lowest nonce for every sender:nonceKeyKey pair)
const prioriyQueueKey = (chainId: number) =>
    `${chainId}:outstanding:priority-queue`

// Used to keep track of pending ops by sender:nonceKeyKey pair
const senderNonceKeyIndex = (userOp: UserOperation, chainId: number) => {
    const sender = userOp.sender
    const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
    const fingerPrint = `${sender}-${nonceKey}`
    return `${chainId}:outstanding:pending-ops:${fingerPrint}`
}

// Used to keep track of active sender:nonceKey pair slots (for easier cleanup + finding how many ops are pending)
const senderNonceKeySlotsKey = (chainId: number) =>
    `${chainId}:outstanding:slots`

const serializeUserOpInfo = (userOpInfo: UserOpInfo): string => {
    return JSON.stringify(userOpInfo, (_, value) =>
        typeof value === "bigint" ? value.toString() : value
    )
}

const deserializeUserOpInfo = (data: string): UserOpInfo => {
    const parsed = JSON.parse(data)
    return userOpInfoSchema.parse(parsed)
}

export const createRedisOutstandingQueue = ({
    config
}: {
    config: AltoConfig
}): OutstandingStore => {
    const chainId = config.chainId
    const logger = config.getLogger(
        { module: "redis-outstanding-queue" },
        {
            level: config.logLevel
        }
    )

    const { redisMempoolUrl } = config
    if (!redisMempoolUrl) {
        throw new Error("missing required redisMempoolUrl")
    }

    const redisClient = new Redis(redisMempoolUrl)

    // Adds userOp to queue and maintains sorting by gas price
    const addToPriorityQueue = async (userOpInfo: UserOpInfo) => {
        const { userOp } = userOpInfo
        const senderNonceKey = senderNonceKeyIndex(userOp, chainId)

        await redisClient.zadd(
            prioriyQueueKey(chainId),
            Number(userOpInfo.userOp.maxFeePerGas), // Score
            senderNonceKey
        )
    }

    // Add userOpInfo to sender:nonceKeyKey queue
    const addToSenderNonceKeyQueue = async (userOpInfo: UserOpInfo) => {
        const { userOp } = userOpInfo
        const [, nonceSeq] = getNonceKeyAndSequence(userOp.nonce)
        const senderNonceKey = senderNonceKeyIndex(userOp, chainId)

        // Add to the sender:nonceKey sorted set with nonceSeq as score
        await redisClient.zadd(
            senderNonceKey,
            Number(nonceSeq),
            serializeUserOpInfo(userOpInfo)
        )

        // Record sender:nonceKey key
        await redisClient.sadd(senderNonceKeySlotsKey(chainId), senderNonceKey)
    }

    // Returns sorted pending ops by nonceSeq for a given sender:nonceKey pair
    const getSortedPendingOps = async (
        userOpInfo: UserOpInfo
    ): Promise<UserOpInfo[]> => {
        const { userOp } = userOpInfo

        const zsetKey = senderNonceKeyIndex(userOp, chainId)
        const entries = await redisClient.zrange(zsetKey, 0, -1)
        return entries.map(deserializeUserOpInfo)
    }

    return {
        pop: async () => {
            const multi = redisClient.multi()
            multi.zrange(prioriyQueueKey(chainId), 0, 0)
            multi.zremrangebyrank(prioriyQueueKey(chainId), 0, 0)
            const results = await multi.exec()

            if (
                !results ||
                !results[0][1] ||
                (results[0][1] as string[]).length === 0
            ) {
                return undefined
            }

            const userOpInfoStr = (results[0][1] as string[])[0]
            const userOpInfo = deserializeUserOpInfo(userOpInfoStr)

            // Remove this userOp from the sorted set
            const senderNonceKey = senderNonceKeyIndex(
                userOpInfo.userOp,
                chainId
            )
            await redisClient.zrem(senderNonceKey, userOpInfoStr)

            // Get remaining operations for this slot
            const sortedOps = await getSortedPendingOps(userOpInfo)

            // If there are more items, add the next one to the priority queue
            if (sortedOps.length > 0) {
                await addToPriorityQueue(sortedOps[0])
            } else {
                // If no more pending operations, cleanup by removing the sender:nonceKey and the slot
                await redisClient
                    .multi()
                    .del(senderNonceKey)
                    .srem(senderNonceKeySlotsKey(chainId), senderNonceKey)
                    .exec()
            }

            return userOpInfo
        },

        add: async (userOpInfo: UserOpInfo) => {
            const { userOpHash } = userOpInfo

            addToSenderNonceKeyQueue(userOpInfo)

            // If this is the lowest nonce for sender:nonceKeyKey pair, update the priority queue
            const sortedOps = await getSortedPendingOps(userOpInfo)
            if (
                sortedOps.length > 0 &&
                sortedOps[0].userOpHash === userOpHash
            ) {
                await addToPriorityQueue(userOpInfo)
            }
        },

        remove: async (userOpHash: HexData32) => {
            // Find the userOp in the priority queue
            const priorityQueueItems = await redisClient.zrange(
                prioriyQueueKey(chainId),
                0,
                -1
            )
            const priorityQueue = priorityQueueItems.map(deserializeUserOpInfo)

            const userOpInfoIndex = priorityQueue.findIndex(
                (info) => info.userOpHash === userOpHash
            )

            if (userOpInfoIndex === -1) {
                logger.info("tried to remove non-existent user op from mempool")
                return false
            }

            const userOpInfo = priorityQueue[userOpInfoIndex]
            const senderNonceKey = senderNonceKeyIndex(
                userOpInfo.userOp,
                chainId
            )

            // Remove from priority queue
            await redisClient.zrem(
                prioriyQueueKey(chainId),
                priorityQueueItems[userOpInfoIndex]
            )

            // Remove from sorted set
            await redisClient.zrem(
                senderNonceKey,
                serializeUserOpInfo(userOpInfo)
            )

            // Get remaining operations for this slot
            const sortedOps = await getSortedPendingOps(userOpInfo)

            // If there are more operations, add the first one to priority queue
            if (sortedOps.length > 0) {
                await addToPriorityQueue(sortedOps[0])
            } else {
                // If no more operations, remove the hash and the slot
                await redisClient
                    .pipeline()
                    .del(senderNonceKey)
                    .srem(senderNonceKeySlotsKey(chainId), senderNonceKey)
                    .exec()
            }

            return true
        },

        dump: async () => {
            // Get all slots
            const slots = await redisClient.smembers(
                senderNonceKeySlotsKey(chainId)
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
            // Clear the priority queue
            await redisClient.del(prioriyQueueKey(chainId))

            // Get all slots
            const slots = await redisClient.smembers(
                senderNonceKeySlotsKey(chainId)
            )

            if (slots.length > 0) {
                const pipeline = redisClient.pipeline()

                // Delete all hash keys
                for (const slot of slots) {
                    pipeline.del(slot)
                }

                // Clear the slots set
                pipeline.del(senderNonceKeySlotsKey(chainId))

                await pipeline.exec()
            }

            return Promise.resolve()
        },

        length: async () => {
            // Count total number of operations across all slots
            const slots = await redisClient.smembers(
                senderNonceKeySlotsKey(chainId)
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
