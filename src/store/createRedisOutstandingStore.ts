import { getNonceKeyAndSequence } from "../utils/userop"
import { AltoConfig } from "../createConfig"
import { UserOpInfo } from "../types/mempool"
import { HexData32, UserOperation } from "@alto/types"
import { OutstandingStore } from "."
import Redis from "ioredis"

// Redis key prefixes
const PRIORITY_QUEUE_KEY = "alto:outstanding:priority_queue"
const PENDING_OPS_PREFIX = "alto:outstanding:pending:"
const USEROPS_PREFIX = "alto:outstanding:userops:"

// Helper to create a unique key for sender-nonce combinations
const senderNonceSlot = (userOp: UserOperation) => {
    const sender = userOp.sender
    const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
    return `${sender}-${nonceKey}`
}

// Helper to serialize UserOpInfo for Redis storage
const serializeUserOpInfo = (userOpInfo: UserOpInfo): string => {
    return JSON.stringify(userOpInfo)
}

// Helper to deserialize UserOpInfo from Redis storage
const deserializeUserOpInfo = (serialized: string): UserOpInfo => {
    return JSON.parse(serialized)
}

export const createRedisOutstandingQueue = ({
    config
}: {
    config: AltoConfig
}): OutstandingStore => {
    if (!config.redisMempoolUrl) {
        throw new Error("Redis mempool URL not configured")
    }

    const logger = config.getLogger(
        { module: "redis-outstanding-queue" },
        {
            level: config.logLevel
        }
    )

    // Create Redis client if not provided
    const redis = new Redis(config.redisMempoolUrl)

    // Add a UserOp to the priority queue
    const addToPriorityQueue = async (
        userOpInfo: UserOpInfo
    ): Promise<void> => {
        const serialized = serializeUserOpInfo(userOpInfo)

        // Store the UserOpInfo by its hash
        await redis.set(`${USEROPS_PREFIX}${userOpInfo.userOpHash}`, serialized)

        // Add to sorted set with maxFeePerGas as score for priority ordering
        await redis.zadd(
            PRIORITY_QUEUE_KEY,
            Number(userOpInfo.userOp.maxFeePerGas),
            userOpInfo.userOpHash
        )
    }

    // Add a UserOp to the store
    const add = async (userOpInfo: UserOpInfo): Promise<void> => {
        const { userOp, userOpHash } = userOpInfo
        const pendingOpsSlot = senderNonceSlot(userOp)
        const pendingOpsKey = `${PENDING_OPS_PREFIX}${pendingOpsSlot}`

        // Store the UserOpInfo
        await redis.set(
            `${USEROPS_PREFIX}${userOpHash}`,
            serializeUserOpInfo(userOpInfo)
        )

        // Add to the pending ops list for this sender-nonce
        await redis.rpush(pendingOpsKey, userOpHash)

        // Get all userOps for this sender-nonce
        const backlogOpHashes = await redis.lrange(pendingOpsKey, 0, -1)

        // Get all the UserOpInfo objects
        const backlogOpsPromises = backlogOpHashes.map(async (hash) => {
            const serialized = await redis.get(`${USEROPS_PREFIX}${hash}`)
            return serialized ? deserializeUserOpInfo(serialized) : null
        })

        const backlogOps = (await Promise.all(backlogOpsPromises)).filter(
            Boolean
        ) as UserOpInfo[]

        // Sort by nonce sequence
        backlogOps.sort((a, b) => {
            const [, aNonceSeq] = getNonceKeyAndSequence(a.userOp.nonce)
            const [, bNonceSeq] = getNonceKeyAndSequence(b.userOp.nonce)
            return Number(aNonceSeq) - Number(bNonceSeq)
        })

        // Reorder the list in Redis to match our sorted order
        if (backlogOps.length > 0) {
            await redis.del(pendingOpsKey)
            await redis.rpush(
                pendingOpsKey,
                ...backlogOps.map((op) => op.userOpHash)
            )
        }

        // Check if this is the lowest nonce (first in queue)
        const lowestUserOpHash = backlogOps[0]?.userOpHash

        if (lowestUserOpHash === userOpHash) {
            // Remove any existing userOp with same sender and nonceKey from priority queue
            const allPriorityQueueHashes = await redis.zrange(
                PRIORITY_QUEUE_KEY,
                0,
                -1
            )

            for (const hash of allPriorityQueueHashes) {
                const serialized = await redis.get(`${USEROPS_PREFIX}${hash}`)
                if (!serialized) continue

                const info = deserializeUserOpInfo(serialized)
                const pendingUserOp = info.userOp
                const [existingNonceKey] = getNonceKeyAndSequence(
                    pendingUserOp.nonce
                )
                const [newNonceKey] = getNonceKeyAndSequence(userOp.nonce)

                const isSameSender = pendingUserOp.sender === userOp.sender
                const isSameNonceKey = existingNonceKey === newNonceKey

                if (isSameSender && isSameNonceKey && hash !== userOpHash) {
                    await redis.zrem(PRIORITY_QUEUE_KEY, hash)
                }
            }

            // Add current userOp to priority queue
            await addToPriorityQueue(userOpInfo)
        }
    }

    // Pop the highest priority UserOp
    const pop = async (): Promise<UserOpInfo | undefined> => {
        // Get the highest priority userOp (lowest score in the sorted set)
        const userOpHashes = await redis.zrange(PRIORITY_QUEUE_KEY, 0, 0)

        if (!userOpHashes.length) {
            return undefined
        }

        const userOpHash = userOpHashes[0]

        // Remove from priority queue
        await redis.zrem(PRIORITY_QUEUE_KEY, userOpHash)

        // Get the UserOpInfo
        const serialized = await redis.get(`${USEROPS_PREFIX}${userOpHash}`)
        if (!serialized) {
            logger.error(
                `FATAL: UserOp with hash ${userOpHash} not found in Redis`
            )
            return undefined
        }

        const userOpInfo = deserializeUserOpInfo(serialized)
        const pendingOpsSlot = senderNonceSlot(userOpInfo.userOp)
        const pendingOpsKey = `${PENDING_OPS_PREFIX}${pendingOpsSlot}`

        // Remove from pending ops
        await redis.lrem(pendingOpsKey, 1, userOpHash)

        // Get the next pending op for this sender-nonce if it exists
        const nextOpHash = await redis.lindex(pendingOpsKey, 0)

        if (nextOpHash) {
            const nextOpSerialized = await redis.get(
                `${USEROPS_PREFIX}${nextOpHash}`
            )
            if (nextOpSerialized) {
                const nextOpInfo = deserializeUserOpInfo(nextOpSerialized)
                await addToPriorityQueue(nextOpInfo)
            }
        } else {
            // No more pending ops for this sender-nonce, clean up
            await redis.del(pendingOpsKey)
        }

        return userOpInfo
    }

    // Remove a UserOp by hash
    const remove = async (userOpHash: HexData32): Promise<boolean> => {
        // Check if the userOp exists
        const serialized = await redis.get(`${USEROPS_PREFIX}${userOpHash}`)
        if (!serialized) {
            logger.info("tried to remove non-existent user op from mempool")
            return false
        }

        const userOpInfo = deserializeUserOpInfo(serialized)
        const pendingOpsSlot = senderNonceSlot(userOpInfo.userOp)
        const pendingOpsKey = `${PENDING_OPS_PREFIX}${pendingOpsSlot}`

        // Remove from priority queue
        await redis.zrem(PRIORITY_QUEUE_KEY, userOpHash)

        // Find position in the pending ops list
        const pendingOps = await redis.lrange(pendingOpsKey, 0, -1)
        const backlogIndex = pendingOps.indexOf(userOpHash)

        if (backlogIndex === -1) {
            logger.error(
                `FATAL: UserOp with hash ${userOpHash} not found in backlog`
            )
            return false
        }

        // Remove from pending ops
        await redis.lrem(pendingOpsKey, 1, userOpHash)

        // If this was the first operation and there are more in the backlog,
        // add the new first operation to the priority queue
        if (backlogIndex === 0) {
            const nextOpHash = await redis.lindex(pendingOpsKey, 0)
            if (nextOpHash) {
                const nextOpSerialized = await redis.get(
                    `${USEROPS_PREFIX}${nextOpHash}`
                )
                if (nextOpSerialized) {
                    const nextOpInfo = deserializeUserOpInfo(nextOpSerialized)
                    await addToPriorityQueue(nextOpInfo)
                }
            }
        }

        // Clean up the stored UserOpInfo
        await redis.del(`${USEROPS_PREFIX}${userOpHash}`)

        return true
    }

    // Clear all data
    const clear = async (): Promise<void> => {
        // Get all keys with our prefixes
        const priorityQueueKeys = [PRIORITY_QUEUE_KEY]
        const pendingOpsKeys = await redis.keys(`${PENDING_OPS_PREFIX}*`)
        const userOpsKeys = await redis.keys(`${USEROPS_PREFIX}*`)

        // Delete all keys
        const allKeys = [
            ...priorityQueueKeys,
            ...pendingOpsKeys,
            ...userOpsKeys
        ]
        if (allKeys.length > 0) {
            await redis.del(...allKeys)
        }
    }

    // Dump all UserOps
    const dump = async (): Promise<UserOpInfo[]> => {
        // Get all UserOp hashes from priority queue and pending ops
        const priorityQueueHashes = await redis.zrange(
            PRIORITY_QUEUE_KEY,
            0,
            -1
        )
        const pendingOpsKeys = await redis.keys(`${PENDING_OPS_PREFIX}*`)

        const pendingOpsHashesPromises = pendingOpsKeys.map((key) =>
            redis.lrange(key, 0, -1)
        )

        const pendingOpsHashesArrays = await Promise.all(
            pendingOpsHashesPromises
        )
        const pendingOpsHashes = pendingOpsHashesArrays.flat()

        // Combine and deduplicate hashes
        const allHashes = [
            ...new Set([...priorityQueueHashes, ...pendingOpsHashes])
        ]

        // Get all UserOpInfo objects
        const userOpInfoPromises = allHashes.map(async (hash) => {
            const serialized = await redis.get(`${USEROPS_PREFIX}${hash}`)
            return serialized ? deserializeUserOpInfo(serialized) : null
        })

        const userOpInfos = (await Promise.all(userOpInfoPromises)).filter(
            Boolean
        ) as UserOpInfo[]

        return userOpInfos
    }

    // Get the total number of UserOps
    const getLength = async (): Promise<number> => {
        const userOpsKeys = await redis.keys(`${USEROPS_PREFIX}*`)
        return userOpsKeys.length
    }

    return {
        pop: async () => {
            return pop()
        },
        add: async (userOpInfo: UserOpInfo) => {
            await add(userOpInfo)
            return Promise.resolve()
        },
        remove: async (userOpHash: HexData32) => {
            return remove(userOpHash)
        },
        dump: async () => {
            return dump()
        },
        clear: async () => {
            await clear()
            return Promise.resolve()
        },
        length: async () => {
            return getLength()
        }
    }
}
