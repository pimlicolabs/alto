import { createMemoryMinMaxQueue } from "./createMemoryMinMaxQueue"

export interface MinMaxQueue {
    saveValue(value: bigint): Promise<void>
    getLatestValue(): Promise<bigint | null>
    getMinValue(): Promise<bigint | null>
    getMaxValue(): Promise<bigint | null>
}

export const createMinMaxQueue = (queueValidityMs: number): MinMaxQueue => {
    return createMemoryMinMaxQueue(queueValidityMs)
}
