import {
    type OutstandingStore,
    createMemoryOutstandingQueue,
    createRedisOutstandingQueue
} from "@alto/store"
import type { Logger } from "@alto/utils"
import type { Address } from "viem"
import type { AltoConfig } from "../../createConfig"

export const createOutstandingQueue = ({
    config,
    entryPoint,
    logger
}: {
    config: AltoConfig
    entryPoint: Address
    logger: Logger
}): OutstandingStore => {
    if (config.enableHorizontalScaling && config.redisEndpoint) {
        return createRedisOutstandingQueue({
            config,
            entryPoint,
            redisEndpoint: config.redisEndpoint,
            logger
        })
    }
    return createMemoryOutstandingQueue({ config, logger })
}

export * from "./types"
export * from "./memory"
export * from "./redis"
