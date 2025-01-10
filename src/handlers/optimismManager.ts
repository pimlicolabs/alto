import { SlidingWindowTimedQueue } from "../utils/slidingWindowTimedQueue"

export class OptimismManager {
    private l1FeeQueue: SlidingWindowTimedQueue

    constructor(queueValidity: number) {
        this.l1FeeQueue = new SlidingWindowTimedQueue(queueValidity)
    }

    public getMinL1Fee() {
        return this.l1FeeQueue.getMinValue() || 1n
    }

    public saveL1FeeValue(l1Fee: bigint) {
        this.l1FeeQueue.saveValue(l1Fee)
    }
}
