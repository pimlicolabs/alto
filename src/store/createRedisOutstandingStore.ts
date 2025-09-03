import {
    type Address,
    type HexData32,
    type UserOpInfo,
    type UserOperation,
    userOpInfoSchema
} from "@alto/types"
import { type ChainableCommander, Redis } from "ioredis"
import { toHex } from "viem/utils"
import type { OutstandingStore } from "."
import type { AltoConfig } from "../createConfig"
import {
    getNonceKeyAndSequence,
    isVersion06,
    isVersion07
} from "../utils/userop"

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

const isDeployment = (userOp: UserOperation): boolean => {
    const isV6Deployment =
        isVersion06(userOp) && !!userOp.initCode && userOp.initCode !== "0x"
    const isV7Deployment =
        isVersion07(userOp) && !!userOp.factory && userOp.factory !== "0x"
    return isV6Deployment || isV7Deployment
}

class RedisSortedSet {
    constructor(
        private redis: Redis,
        private keyName: string
    ) {}

    get keyPath(): string {
        return this.keyName
    }

    async add({
        member,
        score,
        multi = this.redis
    }: {
        member: string
        score: number
        multi?: ChainableCommander | Redis
    }): Promise<void> {
        await multi.zadd(this.keyPath, score, member)
    }

    async remove({
        member,
        multi = this.redis
    }: {
        member: string
        multi?: ChainableCommander | Redis
    }): Promise<void> {
        await multi.zrem(this.keyPath, member)
    }

    getByScoreRange(min: number, max: number): Promise<string[]> {
        return Promise.resolve(this.redis.zrangebyscore(this.keyPath, min, max))
    }

    getByRankRange(start: number, stop: number): Promise<string[]> {
        return Promise.resolve(this.redis.zrange(this.keyPath, start, stop))
    }

    async popMax(): Promise<string | undefined> {
        type ZmpopResult = [string, [string, string][]] // [key, [[member, score], ...]]

        const result = (await this.redis.zmpop(
            1,
            [this.keyPath],
            "MAX",
            "COUNT",
            1
        )) as ZmpopResult

        return result && result[1].length > 0 ? result[1][0][0] : undefined
    }

    async popMin(): Promise<string | undefined> {
        type ZmpopResult = [string, [string, string][]] // [key, [[member, score], ...]]

        const result = (await this.redis.zmpop(
            1,
            [this.keyPath],
            "MIN",
            "COUNT",
            1
        )) as ZmpopResult

        return result && result[1].length > 0 ? result[1][0][0] : undefined
    }

    async delete({
        multi = this.redis
    }: {
        multi?: ChainableCommander | Redis
    }): Promise<void> {
        await multi.del(this.keyPath)
    }
}

export class RedisHash {
    constructor(
        private redis: Redis,
        private keyName: string
    ) {}

    get keyPath(): string {
        return this.keyName
    }

    async set({
        key,
        value,
        multi = this.redis
    }: {
        key: string
        value: string
        multi?: ChainableCommander | Redis
    }): Promise<void> {
        await multi.hset(this.keyPath, key, value)
    }

    get(field: string): Promise<string | null> {
        return Promise.resolve(this.redis.hget(this.keyPath, field))
    }

    async delete({
        key,
        multi = this.redis
    }: {
        key: string
        multi?: ChainableCommander | Redis
    }): Promise<void> {
        await multi.hdel(this.keyPath, key)
    }

    async exists(field: string): Promise<boolean> {
        return (await this.redis.hexists(this.keyPath, field)) === 1
    }

    getAll(): Promise<Record<string, string>> {
        return Promise.resolve(this.redis.hgetall(this.keyPath))
    }
}

class RedisOutstandingQueue implements OutstandingStore {
    private redis: Redis
    private chainId: number
    private entryPoint: Address

    // Redis data structures
    private readyOpsQueue: RedisSortedSet // gasPrice -> pendingOpsKey
    private userOpHashLookup: RedisHash // userOpHash -> pendingOpsKey
    private factoryLookup: RedisHash // sender -> userOpHash

    constructor({
        config,
        entryPoint,
        redisEndpoint
    }: { config: AltoConfig; entryPoint: Address; redisEndpoint: string }) {
        this.redis = new Redis(redisEndpoint, {})
        this.chainId = config.chainId
        this.entryPoint = entryPoint

        // Initialize Redis data structures
        const factoryLookupKey = `${this.chainId}:outstanding:factory-lookup:${this.entryPoint}`
        const userOpHashLookupKey = `${this.chainId}:outstanding:user-op-hash-index:${this.entryPoint}`
        const readyOpsQueueKey = `${this.chainId}:outstanding:pending-queue:${this.entryPoint}`

        this.readyOpsQueue = new RedisSortedSet(this.redis, readyOpsQueueKey)
        this.userOpHashLookup = new RedisHash(this.redis, userOpHashLookupKey)
        this.factoryLookup = new RedisHash(this.redis, factoryLookupKey)
    }

    // Helpers
    private getPendingOpsSet(userOp: UserOperation): RedisSortedSet {
        return new RedisSortedSet(this.redis, this.getPendingOpsKey(userOp))
    }

    private getPendingOpsKey(userOp: UserOperation): string {
        const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
        const fingerprint = `${userOp.sender}-${toHex(nonceKey)}`
        return `${this.chainId}:outstanding:pending-ops:${this.entryPoint}:${fingerprint}`
    }

    // OutstandingStore methods
    contains(userOpHash: HexData32): Promise<boolean> {
        return Promise.resolve(this.userOpHashLookup.exists(userOpHash))
    }

    async popConflicting(userOp: UserOperation) {
        const [, nonceSeq] = getNonceKeyAndSequence(userOp.nonce)
        const pendingOpsSet = this.getPendingOpsSet(userOp)

        // Check for operations with the same nonce sequence
        const conflictingNonce = await pendingOpsSet.getByScoreRange(
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
            const conflictingUserOpHash = await this.factoryLookup.get(
                userOp.sender
            )

            if (conflictingUserOpHash) {
                const pendingOpsKey = await this.userOpHashLookup.get(
                    conflictingUserOpHash
                )

                if (pendingOpsKey) {
                    const conflictingPendingOpsSet = new RedisSortedSet(
                        this.redis,
                        pendingOpsKey
                    )
                    const ops = await conflictingPendingOpsSet.getByRankRange(
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

    async peek(): Promise<UserOpInfo | undefined> {
        // Get highest gas price operation's key
        const pendingOpsKeys = await this.readyOpsQueue.getByRankRange(0, 0)

        if (pendingOpsKeys.length === 0) {
            return undefined
        }

        // Get the lowest nonce operation from the pendingOpsKey
        const pendingOpsSet = new RedisSortedSet(this.redis, pendingOpsKeys[0])
        const userOpInfoStrings = await pendingOpsSet.getByRankRange(0, 0)

        if (userOpInfoStrings.length === 0) {
            return undefined
        }

        return deserializeUserOpInfo(userOpInfoStrings[0])
    }

    async add(userOpInfo: UserOpInfo): Promise<void> {
        const { userOpHash, userOp } = userOpInfo
        const pendingOpsSet = this.getPendingOpsSet(userOp)
        const [, nonceSeq] = getNonceKeyAndSequence(userOp.nonce)

        // check if this will be the lowest nonce operation
        // We need this info before starting the transaction
        const existingOps = await pendingOpsSet.getByRankRange(0, 0)
        const isLowestNonce =
            existingOps.length === 0 ||
            userOp.nonce < deserializeUserOpInfo(existingOps[0]).userOp.nonce

        const multi = this.redis.multi()

        // Add to pendingOps sorted set with nonceSeq as score
        await pendingOpsSet.add({
            member: serializeUserOpInfo(userOpInfo),
            score: Number(nonceSeq),
            multi
        })

        // Add to userOpHash lookup
        await this.userOpHashLookup.set({
            key: userOpHash,
            value: pendingOpsSet.keyPath,
            multi
        })

        // Track factory deployments if needed
        if (isDeployment(userOp)) {
            await this.factoryLookup.set({
                key: userOp.sender,
                value: userOpHash,
                multi
            })
        }

        // If lowest nonce, update ready queue with this userOp's gasPrice
        if (isLowestNonce) {
            await this.readyOpsQueue.add({
                member: pendingOpsSet.keyPath,
                score: Number(userOp.maxFeePerGas),
                multi
            })
        }

        await multi.exec()
    }

    async remove(userOpHash: HexData32): Promise<boolean> {
        // Get the userOp info from the secondary index
        const pendingOpsKey = await this.userOpHashLookup.get(userOpHash)
        if (!pendingOpsKey) {
            return false
        }

        // Get all pending operations for this key
        const pendingOpsSet = new RedisSortedSet(this.redis, pendingOpsKey)
        const ops = await pendingOpsSet.getByRankRange(0, -1)

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
            await this.factoryLookup.delete({
                key: userOpInfo.userOp.sender,
                multi
            })
        }

        // Remove from the sorted set
        await pendingOpsSet.remove({
            member: serializeUserOpInfo(userOpInfo),
            multi
        })

        // Remove from hash lookup
        await this.userOpHashLookup.delete({
            key: userOpHash,
            multi
        })

        if (isLowestNonce) {
            // Remove from ready queue
            await this.readyOpsQueue.remove({ member: pendingOpsKey, multi })

            // If we have a next operation, add it to the ready queue
            if (nextOp) {
                await this.readyOpsQueue.add({
                    member: pendingOpsKey,
                    score: Number(nextOp.userOp.maxFeePerGas),
                    multi
                })
            }
        }

        // Execute transaction
        await multi.exec()

        return true
    }

    async pop(): Promise<UserOpInfo | undefined> {
        // Pop highest gas price operation
        const pendingOpsKey = await this.readyOpsQueue.popMax()

        if (!pendingOpsKey) {
            return undefined
        }

        const pendingOpsSet = new RedisSortedSet(this.redis, pendingOpsKey)

        // Get the operations from the set (limited to 2 for efficiency)
        const ops = await pendingOpsSet.getByRankRange(0, 1)

        if (ops.length === 0) {
            return undefined
        }

        const currentUserOpStr = ops[0]
        const currentUserOp = deserializeUserOpInfo(currentUserOpStr)

        // Create a transaction
        const multi = this.redis.multi()

        // Remove the current operation
        await pendingOpsSet.remove({ member: currentUserOpStr, multi })
        await this.userOpHashLookup.delete({
            key: currentUserOp.userOpHash,
            multi
        })

        // Execute transaction
        await multi.exec()

        // Check if there are more operations in this set
        if (ops.length > 1) {
            const nextUserOp = deserializeUserOpInfo(ops[1])
            await this.readyOpsQueue.add({
                member: pendingOpsKey,
                score: Number(nextUserOp.userOp.maxFeePerGas)
            })
        } else {
            // Delete the empty set
            await pendingOpsSet.delete({})
        }

        return currentUserOp
    }

    async getQueuedUserOps(userOp: UserOperation): Promise<UserOperation[]> {
        const pendingOpsSet = this.getPendingOpsSet(userOp)

        const [, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)
        const pendingOps = await pendingOpsSet.getByRankRange(0, -1)

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
    redisEndpoint
}: {
    config: AltoConfig
    entryPoint: Address
    redisEndpoint: string
}): OutstandingStore => {
    return new RedisOutstandingQueue({ config, entryPoint, redisEndpoint })
}
