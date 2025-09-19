import {
    type Address,
    type HexData32,
    type UserOpInfo,
    type UserOperation,
    userOpInfoSchema
} from "@alto/types"
import { getNonceKeyAndSequence } from "@alto/utils"
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
    private readyQueueKey: string // gasPrice -> pendingOpsKey

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
        this.readyQueueKey = `${redisPrefix}:pending-queue`

        // Define the Lua script for atomic add operation
        this.redis.defineCommand("addUserOp", {
            numberOfKeys: 2,
            lua: `
                local pendingOpsKey = KEYS[1]
                local readyQueueKey = KEYS[2]

                local serializedUserOp = ARGV[1]
                local nonceSeq = tonumber(ARGV[2])
                local userOpHash = ARGV[3]
                local maxFeePerGas = tonumber(ARGV[4])

                -- Check if this will be the lowest nonce operation
                local lowestScore = redis.call('ZRANGE', pendingOpsKey, 0, 0, 'WITHSCORES')
                local isLowestNonce

                if #lowestScore == 0 then
                    -- Set is empty
                    isLowestNonce = true
                else
                    local lowestNonceSeq = tonumber(lowestScore[2])
                    isLowestNonce = nonceSeq < lowestNonceSeq
                end

                -- Add to pendingOps sorted set with nonceSeq as score
                redis.call('ZADD', pendingOpsKey, nonceSeq, serializedUserOp)

                -- If lowest nonce, update ready queue with this userOp's gasPrice
                if isLowestNonce then
                    redis.call('ZADD', readyQueueKey, maxFeePerGas, pendingOpsKey)
                end

                return 1
            `
        })

        // Define the Lua script for atomic pop operation
        this.redis.defineCommand("popUserOp", {
            numberOfKeys: 1,
            lua: `
                local readyQueueKey = KEYS[1]

                -- Pop highest gas price operation
                local readyOp = redis.call('ZMPOP', 1, readyQueueKey, 'MAX', 'COUNT', 1)
                if not readyOp or #readyOp == 0 then
                    return nil
                end

                local pendingOpsKey = readyOp[2][1][1]

                -- Pop the lowest nonce operation from the pending ops set
                local poppedOp = redis.call('ZPOPMIN', pendingOpsKey)
                if #poppedOp == 0 then
                    return nil
                end

                local currentOp = poppedOp[1]

                -- Check if there are more operations in this set
                local nextOp = redis.call('ZRANGE', pendingOpsKey, 0, 0)
                if #nextOp > 0 then
                    -- Parse next operation to get its maxFeePerGas
                    local nextParsed = cjson.decode(nextOp[1])
                    local maxFeePerGas = tonumber(nextParsed.userOp.maxFeePerGas)

                    -- Re-add to ready queue with next operation's gas price
                    redis.call('ZADD', readyQueueKey, maxFeePerGas, pendingOpsKey)
                else
                    -- Delete empty set
                    redis.call('DEL', pendingOpsKey)
                end

                return currentOp
            `
        })

        logger.info(
            {
                readyQueueKey: this.readyQueueKey
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
    async contains(_userOpHash: HexData32): Promise<boolean> {
        return false
        //return (
        //    (await this.redis.hexists(this.userOpHashLookupKey, userOpHash)) ===
        //    1
        //)
    }

    async popConflicting(_userOp: UserOperation) {
        //const [, nonceSeq] = getNonceKeyAndSequence(userOp.nonce)
        //const pendingOpsKey = this.getPendingOpsKey(userOp)

        //// Check for operations with the same nonce sequence
        //const conflictingNonce = await this.redis.zrangebyscore(
        //    pendingOpsKey,
        //    Number(nonceSeq),
        //    Number(nonceSeq)
        //)

        //if (conflictingNonce.length > 0) {
        //    const conflicting = deserializeUserOpInfo(conflictingNonce[0])
        //    await this.remove(conflicting.userOpHash)
        //    return {
        //        reason: "conflicting_nonce" as const,
        //        userOpInfo: conflicting
        //    }
        //}

        return undefined
    }

    async add(userOpInfo: UserOpInfo): Promise<void> {
        const { userOpHash, userOp } = userOpInfo
        const pendingOpsKey = this.getPendingOpsKey(userOp)
        const [, nonceSeq] = getNonceKeyAndSequence(userOp.nonce)

        // @ts-ignore - defineCommand adds the method at runtime
        await this.redis.addUserOp(
            pendingOpsKey,
            this.readyQueueKey,
            serializeUserOpInfo(userOpInfo),
            Number(nonceSeq).toString(),
            userOpHash,
            Number(userOp.maxFeePerGas).toString()
        )
    }

    async remove(_userOpHash: HexData32): Promise<boolean> {
        return false
    }

    async pop(): Promise<UserOpInfo | undefined> {
        // Use atomic Lua script for pop operation
        // @ts-ignore - defineCommand adds the method at runtime
        const result = (await this.redis.popUserOp(this.readyQueueKey)) as
            | string
            | null

        return result ? deserializeUserOpInfo(result) : undefined
    }

    async getQueuedUserOps(userOp: UserOperation): Promise<UserOperation[]> {
        const pendingOpsKey = this.getPendingOpsKey(userOp)

        const [, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)

        // Get operations with nonce sequence less than the current one using score range
        const pendingOps = await this.redis.zrangebyscore(
            pendingOpsKey,
            "-inf",
            `(${Number(nonceSequence)}` // Exclusive upper bound
        )

        return pendingOps
            .map(deserializeUserOpInfo)
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
