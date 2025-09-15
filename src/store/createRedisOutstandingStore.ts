import {
    type Address,
    type HexData32,
    type UserOpInfo,
    type UserOperation,
    userOpInfoSchema
} from "@alto/types"
import { Redis } from "ioredis"
import { toHex } from "viem/utils"
import type { OutstandingStore } from "."
import type { AltoConfig } from "../createConfig"
import {
    getNonceKeyAndSequence,
    isVersion06,
    isVersion07
} from "../utils/userop"
import { LUA_SCRIPTS } from "./redisLuaScripts"

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

class RedisOutstandingQueue implements OutstandingStore {
    private redis: Redis
    private chainId: number
    private entryPoint: Address

    // Redis key names
    private readyQueueKey: string // gasPrice -> pendingOpsKey (sorted set)
    private userOpIndexKey: string // userOpHash -> pendingOpsKey (hash)
    private factoryIndexKey: string // sender -> userOpHash (hash)

    constructor({
        config,
        entryPoint,
        redisEndpoint
    }: { config: AltoConfig; entryPoint: Address; redisEndpoint: string }) {
        this.redis = new Redis(redisEndpoint, {
            enableAutoPipelining: true,
            autoPipeliningIgnoredCommands: ["multi", "exec"]
        })
        this.chainId = config.chainId
        this.entryPoint = entryPoint

        // Initialize Redis key names
        this.factoryIndexKey = `${this.chainId}:${this.entryPoint}:outstanding:factory-index`
        this.userOpIndexKey = `${this.chainId}:${this.entryPoint}:outstanding:userop-index`
        this.readyQueueKey = `${this.chainId}:${this.entryPoint}:outstanding:ready-queue`

        // Define custom Redis commands using Lua scripts
        this.redis.defineCommand("atomicPop", {
            numberOfKeys: 3,
            lua: LUA_SCRIPTS.POP_OPERATION
        })

        this.redis.defineCommand("atomicRemove", {
            numberOfKeys: 4,
            lua: LUA_SCRIPTS.REMOVE_OPERATION
        })

        this.redis.defineCommand("atomicAdd", {
            numberOfKeys: 4,
            lua: LUA_SCRIPTS.ADD_OPERATION
        })

        this.redis.defineCommand("atomicPeek", {
            numberOfKeys: 1,
            lua: LUA_SCRIPTS.PEEK_OPERATION
        })

        this.redis.defineCommand("checkConflicts", {
            numberOfKeys: 2,
            lua: LUA_SCRIPTS.CHECK_CONFLICTS
        })
    }

    // Helpers
    private getPendingOpsKey(userOp: UserOperation): string {
        const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
        const fingerprint = `${userOp.sender}-${toHex(nonceKey)}`
        return `${this.chainId}:${this.entryPoint}:outstanding:pending-ops:${fingerprint}`
    }

    // OutstandingStore methods
    async contains(userOpHash: HexData32): Promise<boolean> {
        return (await this.redis.hexists(this.userOpIndexKey, userOpHash)) === 1
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
                this.factoryIndexKey,
                userOp.sender
            )

            if (conflictingUserOpHash) {
                const pendingOpsKey = await this.redis.hget(
                    this.userOpIndexKey,
                    conflictingUserOpHash
                )

                if (pendingOpsKey) {
                    const ops = await this.redis.zrange(pendingOpsKey, 0, -1)
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

        // Prepare serialized data with deployment flag for Lua
        const serializedInfo = serializeUserOpInfo(userOpInfo)

        const result = await this.redis.call(
            "atomicAdd",
            pendingOpsKey,
            this.userOpIndexKey,
            this.factoryIndexKey,
            this.readyQueueKey,
            serializedInfo,
            userOpHash,
            String(nonceSeq),
            isDeployment(userOp) ? "1" : "0",
            userOp.sender,
            String(userOp.maxFeePerGas)
        )

        if (result === "Already exists") {
            throw new Error(`UserOp ${userOpHash} already exists`)
        }
    }

    async remove(userOpHash: HexData32): Promise<boolean> {
        // Get the userOp info from the secondary index
        const pendingOpsKey = await this.redis.hget(
            this.userOpIndexKey,
            userOpHash
        )
        if (!pendingOpsKey) {
            return false
        }

        // Get the operation to remove (only need first 2 for checking)
        const ops = await this.redis.zrange(pendingOpsKey, 0, 1)

        if (ops.length === 0) {
            return false
        }

        // Find the specific operation
        const userOpInfo = ops
            .map(deserializeUserOpInfo)
            .find((op) => op.userOpHash === userOpHash)

        if (!userOpInfo) {
            // If not in first 2, need to fetch more
            const allOps = await this.redis.zrange(pendingOpsKey, 0, -1)
            const found = allOps
                .map(deserializeUserOpInfo)
                .find((op) => op.userOpHash === userOpHash)

            if (!found) {
                return false
            }

            // Use the Lua script for atomic removal
            const result = (await this.redis.call(
                "atomicRemove",
                pendingOpsKey,
                this.userOpIndexKey,
                this.factoryIndexKey,
                this.readyQueueKey,
                userOpHash,
                serializeUserOpInfo(found),
                isDeployment(found.userOp) ? "1" : "0",
                found.userOp.sender
            )) as number

            return result === 1
        }

        // Use the Lua script for atomic removal
        const result = (await this.redis.call(
            "atomicRemove",
            pendingOpsKey,
            this.userOpIndexKey,
            this.factoryIndexKey,
            this.readyQueueKey,
            userOpHash,
            serializeUserOpInfo(userOpInfo),
            isDeployment(userOpInfo.userOp) ? "1" : "0",
            userOpInfo.userOp.sender
        )) as number

        return result === 1
    }

    async pop(): Promise<UserOpInfo | undefined> {
        const result = (await this.redis.call(
            "atomicPop",
            this.readyQueueKey,
            this.userOpIndexKey,
            this.factoryIndexKey
        )) as string | null

        return result ? deserializeUserOpInfo(result) : undefined
    }

    async getQueuedUserOps(userOp: UserOperation): Promise<UserOperation[]> {
        const pendingOpsKey = this.getPendingOpsKey(userOp)
        const [, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)

        // Only fetch operations with nonce sequence less than the current one.
        const pendingOps = await this.redis.zrangebyscore(
            pendingOpsKey,
            0,
            Number(nonceSequence) - 1
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
    redisEndpoint
}: {
    config: AltoConfig
    entryPoint: Address
    redisEndpoint: string
}): OutstandingStore => {
    return new RedisOutstandingQueue({ config, entryPoint, redisEndpoint })
}
