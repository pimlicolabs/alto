import { AltoConfig } from "../../createConfig"
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
    keyPrefix
}: { config: AltoConfig; keyPrefix: string }): MinMaxQueue => {
    if (config.redisGasPriceQueueUrl) {
        return createRedisMinMaxQueue({
            config,
            keyPrefix
        })
    }

    return createMemoryMinMaxQueue({ config })
}
