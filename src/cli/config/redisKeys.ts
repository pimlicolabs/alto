import type { AltoConfig } from "../../createConfig"

export const getRedisKeys = (config: AltoConfig) => {
    const prefix = `${config.redisKeyPrefix}:${config.chainId}`

    return {
        // Mempool queue
        mempoolQueue: `${prefix}:outstanding-mempool`,

        // User operation receipt cache - returns just the key prefix for receipt cache
        userOpReceiptCachePrefix: `${prefix}:receipt-cache`,

        // User operation status
        userOpStatusQueue: `${prefix}:userop-status`,

        // Gas price queue
        gasPriceQueue: `${prefix}:gas-price`,

        // Sender manager queue
        senderManagerQueue: `${prefix}:sender-manager`
    }
}
