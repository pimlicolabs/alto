import type { Address } from "viem"
import type { AltoConfig } from "../../createConfig"

import {
    InMemoryProcessingStore,
    type ProcessingStore,
    RedisProcessingStore
} from "@alto/store"

// Holds all userOps that have been removed from outstanding pool and are being processed.
// UserOps are are removed from this store when they have successfully landed onchain or when they are cancelled.
export function createProcessingStore({
    config,
    entryPoint
}: {
    config: AltoConfig
    entryPoint: Address
}): ProcessingStore {
    if (config.enableHorizontalScaling && config.redisEndpoint) {
        return new RedisProcessingStore({
            config,
            entryPoint,
            redisEndpoint: config.redisEndpoint
        })
    }
    return new InMemoryProcessingStore()
}

export * from "./types"
export * from "./memory"
export * from "./redis"
