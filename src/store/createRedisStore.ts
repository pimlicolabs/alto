import Redis from "ioredis"
import { type Address, toHex } from "viem"
import type { Store } from "."
import type { AltoConfig } from "../createConfig"
import {
    type HexData32,
    type UserOpInfo,
    type UserOperation,
    userOperationSchema
} from "../types/schemas"
import { isVersion06, isVersion07 } from "../utils/userop"
import { RedisHash } from "./createRedisOutstandingStore"
import { createMemoryStore } from "./createStore"

const isDeploymentOperation = (userOp: UserOperation): boolean => {
    const isV6Deployment =
        isVersion06(userOp) && !!userOp.initCode && userOp.initCode !== "0x"
    const isV7Deployment =
        isVersion07(userOp) && !!userOp.factory && userOp.factory !== "0x"
    return isV6Deployment || isV7Deployment
}

const serializeUserOp = (userOpInfo: UserOperation): string => {
    return JSON.stringify(userOpInfo, (_, value) =>
        typeof value === "bigint" ? toHex(value) : value
    )
}

const deserializeUserOp = (data: string): UserOperation => {
    try {
        const parsed = JSON.parse(data)
        const result = userOperationSchema.safeParse(parsed)

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

export const createRedisStore = ({
    config,
    storeType,
    entryPoint,
    redisEndpoint
}: {
    config: AltoConfig
    storeType: string
    entryPoint: Address
    redisEndpoint: string
}): Store => {
    const redis = new Redis(redisEndpoint, {})

    const factoryLookupKey = `${config.chainId}:${storeType}:factory-lookup:${entryPoint}`
    const conflictingNonceKey = `${config.chainId}:${storeType}:conflicting-nonce:${entryPoint}`
    const userOpHashLookupKey = `${config.chainId}:${storeType}:user-op-hash-index:${entryPoint}`
    const senderNonceLookupKey = `${config.chainId}:${storeType}:sender-nonce-lookup:${entryPoint}`

    const conflictingNonce = new RedisHash(redis, conflictingNonceKey) // userOpHash -> userOp
    const factoryLookup = new RedisHash(redis, factoryLookupKey) // sender -> userOpHash (if deployment is present)
    const senderNonceLookup = new RedisHash(redis, senderNonceLookupKey) // sender + nonce -> userOp
    const userOpHashLookup = new RedisHash(redis, userOpHashLookupKey) // userOpHash -> userOp

    const memoryStore = createMemoryStore({ config })

    const encodeSenderNonce = (userOp: UserOperation) => {
        return `${userOp.sender}-${userOp.nonce}`
    }

    return {
        add: async (op: UserOpInfo) => {
            // Local memory logic
            memoryStore.add(op)

            // Global redis logic
            const { userOpHash, userOp } = op

            const multi = redis.multi()

            await userOpHashLookup.set({
                key: userOpHash,
                value: serializeUserOp(userOp),
                multi
            })
            await conflictingNonce.set({
                key: userOpHash,
                value: serializeUserOp(userOp),
                multi
            })
            await senderNonceLookup.set({
                key: encodeSenderNonce(userOp),
                value: serializeUserOp(userOp),
                multi
            })

            if (isDeploymentOperation(userOp)) {
                await factoryLookup.set({
                    key: op.userOp.sender,
                    value: op.userOpHash,
                    multi
                })
            }

            await multi.exec()
        },
        remove: async (userOpHash: HexData32) => {
            // Local memory logic
            memoryStore.remove(userOpHash)

            // Redis Logic
            const exist = await userOpHashLookup.get(userOpHash)

            if (!exist) {
                return false
            }

            const userOp = deserializeUserOp(exist)

            const multi = redis.multi()
            await userOpHashLookup.delete({ key: userOpHash, multi })
            await senderNonceLookup.delete({
                key: encodeSenderNonce(userOp),
                multi
            })
            if (isDeploymentOperation(userOp)) {
                await factoryLookup.delete({ key: userOp.sender, multi })
            }
            await multi.exec()

            return true
        },
        contains: async (userOpHash: HexData32) => {
            return await userOpHashLookup.exists(userOpHash)
        },
        dumpLocal: () => {
            return memoryStore.dumpLocal()
        },
        findConflicting: async (userOp: UserOperation) => {
            const conflictingNonce = await senderNonceLookup.get(
                encodeSenderNonce(userOp)
            )

            if (conflictingNonce) {
                return {
                    reason: "conflicting_nonce",
                    userOp: deserializeUserOp(conflictingNonce)
                }
            }

            if (isDeploymentOperation(userOp)) {
                const userOpHash = await factoryLookup.get(userOp.sender)
                if (userOpHash) {
                    const userOp = await userOpHashLookup.get(userOpHash)

                    if (!userOp) {
                        return undefined
                    }
                    return {
                        reason: "conflicting_deployment",
                        userOp: deserializeUserOp(userOp)
                    }
                }
            }

            return undefined
        }
    }
}
