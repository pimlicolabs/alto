import { maxUint128 } from "viem"
import { getTimedQueue, type TimedQueue } from "../utils/timedQueue"
import type { AltoConfig } from "@alto/config"

export class ArbitrumManager {
    private l1BaseFeeQueue: TimedQueue
    private l2BaseFeeQueue: TimedQueue

    constructor(config: AltoConfig) {
        this.l1BaseFeeQueue = getTimedQueue(config)
        this.l2BaseFeeQueue = getTimedQueue(config)
    }

    public saveL1BaseFee(baseFee: bigint) {
        this.l1BaseFeeQueue.saveValue(baseFee)
    }

    public saveL2BaseFee(baseFee: bigint) {
        this.l2BaseFeeQueue.saveValue(baseFee)
    }

    public async getMinL1BaseFee() {
        const minL1BaseFee = (await this.l1BaseFeeQueue.getMinValue()) || 1n
        return minL1BaseFee
    }

    public async getMaxL1BaseFee() {
        const maxL1BaseFee =
            (await this.l1BaseFeeQueue.getMaxValue()) || maxUint128
        return maxL1BaseFee
    }

    public async getMaxL2BaseFee() {
        const maxL2BaseFee =
            (await this.l2BaseFeeQueue.getMaxValue()) || maxUint128
        return maxL2BaseFee
    }
}
