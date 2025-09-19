import {
    type OutstandingStore,
    createMemoryOutstandingQueue,
    createRedisOutstandingQueue
} from "@alto/store"
import type { Logger } from "@alto/utils"
import type { Address } from "viem"
import type { AltoConfig } from "../../createConfig"
import type { Redis } from "ioredis"

export const createOutstandingQueue = ({
    config,
    entryPoint,
    logger,
    redis
}: {
    config: AltoConfig
    entryPoint: Address
    logger: Logger
    redis?: Redis
}): OutstandingStore => {
    if (config.enableHorizontalScaling && redis) {
        return createRedisOutstandingQueue({
            config,
            entryPoint,
            redis,
            logger
        })
    }
    return createMemoryOutstandingQueue({ config, logger })
}

export * from "./types"
export * from "./memory"
export * from "./redis"
