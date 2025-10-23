import {
    type UserOperationReceipt,
    userOperationReceiptSchema
} from "@alto/types"
import { type Logger, asyncCallWithTimeout } from "@alto/utils"
import * as sentry from "@sentry/node"
import Redis from "ioredis"
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
    redisEndpoint,
    logger
}: {
    config: AltoConfig
    ttl: number
    redisEndpoint: string
    logger: Logger
}): ReceiptCache => {
    const REDIS_TIMEOUT = 500 // 500ms timeout for all Redis operations
    const redis = new Redis(redisEndpoint)
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
                const data = await asyncCallWithTimeout(
                    redis.get(key),
                    REDIS_TIMEOUT
                )

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

        cache: async (receipts: UserOperationReceipt[]): Promise<void> => {
            try {
                const pipeline = redis.pipeline()
                const ttlSeconds = Math.floor(ttl / 1000)

                for (const receipt of receipts) {
                    const key = getKey(receipt.userOpHash)
                    const serialized = serializeReceipt(receipt)
                    pipeline.setex(key, ttlSeconds, serialized)
                }

                await asyncCallWithTimeout(pipeline.exec(), REDIS_TIMEOUT)
            } catch (err) {
                logger.error(
                    { err, count: receipts.length },
                    "Failed to set receipt batch in Redis"
                )
                sentry.captureException(err)
            }
        }
    }
}
