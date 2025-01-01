import { maxUint128 } from "viem"
import { SlidingWindowTimedQueue } from "../utils/slidingWindowTimedQueue"

export class ArbitrumManager {
    private l1BaseFeeQueue: SlidingWindowTimedQueue
    private l2BaseFeeQueue: SlidingWindowTimedQueue

    constructor(queueValidity: number) {
        this.l1BaseFeeQueue = new SlidingWindowTimedQueue(queueValidity)
        this.l2BaseFeeQueue = new SlidingWindowTimedQueue(queueValidity)
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
