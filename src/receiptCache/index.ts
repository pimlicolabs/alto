import type { UserOperationReceipt } from "@alto/types"
import type { Hex } from "viem"
import type { AltoConfig } from "../createConfig"
import { createMemoryReceiptCache } from "./createMemoryReceiptCache"
import { createRedisReceiptCache } from "./createRedisReceiptCache"

export interface ReceiptCache {
    get(userOpHash: Hex): Promise<UserOperationReceipt | undefined>
    set(userOpHash: Hex, receipt: UserOperationReceipt): Promise<void>
}

export { createMemoryReceiptCache } from "./createMemoryReceiptCache"
export { createRedisReceiptCache } from "./createRedisReceiptCache"

export function createReceiptCache(
    config: AltoConfig,
    ttl: number
): ReceiptCache {
    const logger = config.getLogger(
        { module: "receipt-cache" },
        {
            level: config.logLevel
        }
    )

    if (config.enableRedisReceiptCache && config.redisEndpoint) {
        logger.info("Using Redis for user operation receipt cache")
        return createRedisReceiptCache({
            redisEndpoint: config.redisEndpoint,
            config,
            ttl,
            logger
        })
    }

    logger.info("Using memory for user operation receipt cache")
    return createMemoryReceiptCache(ttl)
}
