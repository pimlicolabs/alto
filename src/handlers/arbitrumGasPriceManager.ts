import { maxUint128 } from "viem"
import { TimedQueue } from "../utils/timedQueue"

export class ArbitrumManager {
    private l1BaseFeeQueue: TimedQueue
    private l2BaseFeeQueue: TimedQueue

    constructor(maxQueueSize: number) {
        const queueValidity = 15_000
        this.l1BaseFeeQueue = new TimedQueue(maxQueueSize, queueValidity)
        this.l2BaseFeeQueue = new TimedQueue(maxQueueSize, queueValidity)
    }

    public saveL1BaseFee(baseFee: bigint) {
        this.l1BaseFeeQueue.saveValue(baseFee)
    }

    public saveL2BaseFee(baseFee: bigint) {
        this.l2BaseFeeQueue.saveValue(baseFee)
    }

    public getMinL1BaseFee() {
        let minL1BaseFee = this.l1BaseFeeQueue.getMinValue() || 1n
        return minL1BaseFee
    }

    public getMaxL1BaseFee() {
        let maxL1BaseFee = this.l1BaseFeeQueue.getMaxValue() || maxUint128
        return maxL1BaseFee
    }

    public getMaxL2BaseFee() {
        let maxL2BaseFee = this.l2BaseFeeQueue.getMaxValue() || maxUint128
        return maxL2BaseFee
    }
}
