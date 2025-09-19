import type { UserOperationReceipt } from "@alto/types"
import { userOperationReceiptSchema } from "@alto/types"
import type { Logger } from "@alto/utils"
import { asyncCallWithTimeout } from "@alto/utils"
import * as sentry from "@sentry/node"
import type { Redis } from "ioredis"
import { type Hex, toHex } from "viem"
import type { AltoConfig } from "../createConfig"
import type { ReceiptCache } from "./index"

const serializeReceipt = (receipt: UserOperationReceipt): string => {
    // Convert BigInts to hex strings for JSON serialization
    return JSON.stringify(receipt, (_, value) =>
        typeof value === "bigint" ? toHex(value) : value
    )
}

const deserializeReceipt = (data: string): UserOperationReceipt => {
    // Parse JSON and validate with zod schema
    const parsed = JSON.parse(data)
    return userOperationReceiptSchema.parse(parsed)
}

export const createRedisReceiptCache = ({
    config,
    ttl,
    redis,
    logger
}: {
    config: AltoConfig
    ttl: number
    redis: Redis
    logger: Logger
}): ReceiptCache => {
    const REDIS_TIMEOUT = 100 // 100ms timeout for all Redis operations
    const redisPrefix = `${config.redisKeyPrefix}:${config.chainId}:receipt-cache`

    const getKey = (userOpHash: Hex): string => {
        return `${redisPrefix}:${userOpHash}`
    }

    return {
        get: async (
            userOpHash: Hex
        ): Promise<UserOperationReceipt | undefined> => {
            try {
                const key = getKey(userOpHash)
                const start = performance.now()
                const data = await asyncCallWithTimeout(
                    redis.get(key),
                    REDIS_TIMEOUT
                )
                const duration = (performance.now() - start).toFixed(2)
                logger.info(`[debug-redis] get (receipt) took ${duration}ms`)

                if (!data) {
                    return undefined
                }

                return deserializeReceipt(data)
            } catch (error) {
                logger.error(
                    { error, userOpHash },
                    "Failed to get receipt from Redis"
                )
                sentry.captureException(error)
                return undefined
            }
        },

        set: async (
            userOpHash: Hex,
            receipt: UserOperationReceipt
        ): Promise<void> => {
            try {
                const key = getKey(userOpHash)
                const serialized = serializeReceipt(receipt)

                // Set with TTL in seconds
                const start = performance.now()
                await asyncCallWithTimeout(
                    redis.setex(key, Math.floor(ttl / 1000), serialized),
                    REDIS_TIMEOUT
                )
                const duration = (performance.now() - start).toFixed(2)
                logger.info(`[debug-redis] setex (receipt) took ${duration}ms`)
            } catch (err) {
                logger.error(
                    { err, userOpHash },
                    "Failed to set receipt in Redis"
                )
                sentry.captureException(err)
            }
        }
    }
}
