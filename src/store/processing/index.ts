import type { Address } from "viem"
import type { AltoConfig } from "../../createConfig"
import type { Logger } from "pino"
import type { Redis } from "ioredis"

import {
    InMemoryProcessingStore,
    type ProcessingStore,
    RedisProcessingStore
} from "@alto/store"

// Holds all userOps that have been removed from outstanding pool and are being processed.
// UserOps are are removed from this store when they have successfully landed onchain or when they are cancelled.
export function createProcessingStore({
    config,
    entryPoint,
    logger,
    redis
}: {
    config: AltoConfig
    entryPoint: Address
    logger: Logger
    redis?: Redis
}): ProcessingStore {
    if (config.enableHorizontalScaling && redis) {
        return new RedisProcessingStore({
            config,
            entryPoint,
            redis,
            logger
        })
    }
    return new InMemoryProcessingStore()
}

export * from "./types"
export * from "./memory"
export * from "./redis"
