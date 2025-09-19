import type { AltoConfig } from "../../createConfig"
import { createMemoryMinMaxQueue } from "./createMemoryMinMaxQueue"
import { createRedisMinMaxQueue } from "./createRedisMinMaxQueue"

export interface MinMaxQueue {
    saveValue(value: bigint): Promise<void>
    getLatestValue(): Promise<bigint | null>
    getMinValue(): Promise<bigint | null>
    getMaxValue(): Promise<bigint | null>
}

export const createMinMaxQueue = ({
    config,
    queueName
}: { config: AltoConfig; queueName: string }): MinMaxQueue => {
    if (config.enableHorizontalScaling && config.redisEndpoint) {
        return createRedisMinMaxQueue({
            config,
            queueName: queueName,
            redisEndpoint: config.redisEndpoint
        })
    }

    return createMemoryMinMaxQueue({ config })
}
