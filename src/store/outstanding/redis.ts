import {
    type Address,
    type HexData32,
    type UserOpInfo,
    type UserOperation,
    userOpInfoSchema
} from "@alto/types"
import { getNonceKeyAndSequence, isDeployment } from "@alto/utils"
import { Redis } from "ioredis"
import type { Logger } from "pino"
import { toHex } from "viem/utils"
import type { AltoConfig } from "../../createConfig"
import type { OutstandingStore } from "./types"

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

class RedisOutstandingQueue implements OutstandingStore {
    private redis: Redis
    private config: AltoConfig
    private entryPoint: Address

    // Redis key names
    private readyOpsQueueKey: string // gasPrice -> pendingOpsKey
    private userOpHashLookupKey: string // userOpHash -> pendingOpsKey
    private factoryLookupKey: string // sender -> userOpHash

    constructor({
        config,
        entryPoint,
        redisEndpoint,
        logger
    }: {
        config: AltoConfig
        entryPoint: Address
        redisEndpoint: string
        logger: Logger
    }) {
        this.redis = new Redis(redisEndpoint, {})
        this.config = config
        this.entryPoint = entryPoint

        // Initialize Redis key names
        const redisPrefix = `${config.redisKeyPrefix}:${config.chainId}:${entryPoint}:outstanding`
        this.factoryLookupKey = `${redisPrefix}:factory-lookup`
        this.userOpHashLookupKey = `${redisPrefix}:user-op-hash-index`
        this.readyOpsQueueKey = `${redisPrefix}:pending-queue`

        logger.info(
            {
                factoryLookupKey: this.factoryLookupKey,
                userOpHashLookupKey: this.userOpHashLookupKey,
                readyOpsQueueKey: this.readyOpsQueueKey
            },
            "Using redis for outstanding mempool."
        )
    }

    // Helpers
    private getPendingOpsKey(userOp: UserOperation): string {
        const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
        const fingerprint = `${userOp.sender}-${toHex(nonceKey)}`
        const prefix = `${this.config.redisKeyPrefix}:${this.config.chainId}:${this.entryPoint}:outstanding`
        return `${prefix}:pending-ops:${fingerprint}`
    }

    // OutstandingStore methods
    async contains(userOpHash: HexData32): Promise<boolean> {
        return (await this.redis.hexists(this.userOpHashLookupKey, userOpHash)) === 1
    }

    async popConflicting(userOp: UserOperation) {
        const [, nonceSeq] = getNonceKeyAndSequence(userOp.nonce)
        const pendingOpsKey = this.getPendingOpsKey(userOp)

        // Check for operations with the same nonce sequence
        const conflictingNonce = await this.redis.zrangebyscore(
            pendingOpsKey,
            Number(nonceSeq),
            Number(nonceSeq)
        )

        if (conflictingNonce.length > 0) {
            const conflicting = deserializeUserOpInfo(conflictingNonce[0])
            await this.remove(conflicting.userOpHash)
            return {
                reason: "conflicting_nonce" as const,
                userOpInfo: conflicting
            }
        }

        // Check for conflicting deployments to the same address
        if (isDeployment(userOp)) {
            const conflictingUserOpHash = await this.redis.hget(
                this.factoryLookupKey,
                userOp.sender
            )

            if (conflictingUserOpHash) {
                const conflictingPendingOpsKey = await this.redis.hget(
                    this.userOpHashLookupKey,
                    conflictingUserOpHash
                )

                if (conflictingPendingOpsKey) {
                    const ops = await this.redis.zrange(
                        conflictingPendingOpsKey,
                        0,
                        -1
                    )
                    const userOps = ops.map(deserializeUserOpInfo)

                    const conflictingUserOp = userOps.find(
                        (op) => op.userOpHash === conflictingUserOpHash
                    )

                    if (conflictingUserOp) {
                        await this.remove(conflictingUserOp.userOpHash)
                        return {
                            reason: "conflicting_deployment" as const,
                            userOpInfo: conflictingUserOp
                        }
                    }
                }
            }
        }

        return undefined
    }

    async add(userOpInfo: UserOpInfo): Promise<void> {
        const { userOpHash, userOp } = userOpInfo
        const pendingOpsKey = this.getPendingOpsKey(userOp)
        const [, nonceSeq] = getNonceKeyAndSequence(userOp.nonce)

        // check if this will be the lowest nonce operation
        // We need this info before starting the transaction
        const existingOps = await this.redis.zrange(pendingOpsKey, 0, 0)
        const isLowestNonce =
            existingOps.length === 0 ||
            userOp.nonce < deserializeUserOpInfo(existingOps[0]).userOp.nonce

        const multi = this.redis.multi()

        // Add to pendingOps sorted set with nonceSeq as score
        multi.zadd(
            pendingOpsKey,
            Number(nonceSeq),
            serializeUserOpInfo(userOpInfo)
        )

        // Add to userOpHash lookup
        multi.hset(this.userOpHashLookupKey, userOpHash, pendingOpsKey)

        // Track factory deployments if needed
        if (isDeployment(userOp)) {
            multi.hset(this.factoryLookupKey, userOp.sender, userOpHash)
        }

        // If lowest nonce, update ready queue with this userOp's gasPrice
        if (isLowestNonce) {
            multi.zadd(
                this.readyOpsQueueKey,
                Number(userOp.maxFeePerGas),
                pendingOpsKey
            )
        }

        await multi.exec()
    }

    async remove(userOpHash: HexData32): Promise<boolean> {
        // Get the userOp info from the secondary index
        const pendingOpsKey = await this.redis.hget(
            this.userOpHashLookupKey,
            userOpHash
        )
        if (!pendingOpsKey) {
            return false
        }

        // Get all pending operations for this key
        const ops = await this.redis.zrange(pendingOpsKey, 0, -1)

        if (ops.length === 0) {
            return false
        }

        const userOps = ops.map(deserializeUserOpInfo)
        const userOpInfo = userOps.find((op) => op.userOpHash === userOpHash)

        if (!userOpInfo) {
            return false
        }

        // Check if we're removing the lowest nonce operation
        const isLowestNonce = userOps[0].userOpHash === userOpHash

        // If this is the lowest nonce, check if there's a next operation before starting the transaction
        let nextOp: UserOpInfo | undefined
        if (isLowestNonce && userOps.length > 1) {
            // userOps is already sorted by nonce sequence because it comes from the sorted set
            // So we can simply take the second operation as the next one
            nextOp = userOps[1]
        }

        // Create a transaction
        const multi = this.redis.multi()

        // Clean up factory deployment tracking if needed
        if (isDeployment(userOpInfo.userOp)) {
            multi.hdel(this.factoryLookupKey, userOpInfo.userOp.sender)
        }

        // Remove from the sorted set
        multi.zrem(pendingOpsKey, serializeUserOpInfo(userOpInfo))

        // Remove from hash lookup
        multi.hdel(this.userOpHashLookupKey, userOpHash)

        if (isLowestNonce) {
            // Remove from ready queue
            multi.zrem(this.readyOpsQueueKey, pendingOpsKey)

            // If we have a next operation, add it to the ready queue
            if (nextOp) {
                multi.zadd(
                    this.readyOpsQueueKey,
                    Number(nextOp.userOp.maxFeePerGas),
                    pendingOpsKey
                )
            }
        }

        // Execute transaction
        await multi.exec()

        return true
    }

    async pop(): Promise<UserOpInfo | undefined> {
        // Pop highest gas price operation
        type ZmpopResult = [string, [string, string][]] // [key, [[member, score], ...]]

        const result = (await this.redis.zmpop(
            1,
            [this.readyOpsQueueKey],
            "MAX",
            "COUNT",
            1
        )) as ZmpopResult

        const pendingOpsKey = result && result[1].length > 0 ? result[1][0][0] : undefined

        if (!pendingOpsKey) {
            return undefined
        }

        // Get the operations from the set (limited to 2 for efficiency)
        const ops = await this.redis.zrange(pendingOpsKey, 0, 1)

        if (ops.length === 0) {
            return undefined
        }

        const currentUserOpStr = ops[0]
        const currentUserOp = deserializeUserOpInfo(currentUserOpStr)

        // Create a transaction
        const multi = this.redis.multi()

        // Remove the current operation
        multi.zrem(pendingOpsKey, currentUserOpStr)
        multi.hdel(this.userOpHashLookupKey, currentUserOp.userOpHash)

        // Execute transaction
        await multi.exec()

        // Check if there are more operations in this set
        if (ops.length > 1) {
            const nextUserOp = deserializeUserOpInfo(ops[1])
            await this.redis.zadd(
                this.readyOpsQueueKey,
                Number(nextUserOp.userOp.maxFeePerGas),
                pendingOpsKey
            )
        } else {
            // Delete the empty set
            await this.redis.del(pendingOpsKey)
        }

        return currentUserOp
    }

    async getQueuedUserOps(userOp: UserOperation): Promise<UserOperation[]> {
        const pendingOpsKey = this.getPendingOpsKey(userOp)

        const [, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
        const pendingOps = await this.redis.zrange(pendingOpsKey, 0, -1)

        // Filter operations with nonce sequence less than the current one
        return pendingOps
            .map(deserializeUserOpInfo)
            .filter((opInfo) => {
                const [, opNonceSeq] = getNonceKeyAndSequence(
                    opInfo.userOp.nonce
                )
                return opNonceSeq < nonceSequence
            })
            .map((opInfo) => opInfo.userOp)
    }

    // These methods aren't implemented
    dumpLocal() {
        return Promise.resolve([]) // We can't dump from redis as the latency is too high
    }

    clear(): Promise<void> {
        throw new Error("Not implemented: clear")
    }

    // Skip limit checks when using Redis
    validateQueuedLimit(): boolean {
        return true
    }

    validateParallelLimit(): boolean {
        return true
    }
}

export const createRedisOutstandingQueue = ({
    config,
    entryPoint,
    redisEndpoint,
    logger
}: {
    config: AltoConfig
    entryPoint: Address
    redisEndpoint: string
    logger: Logger
}): OutstandingStore => {
    return new RedisOutstandingQueue({
        config,
        entryPoint,
        redisEndpoint,
        logger
    })
}
