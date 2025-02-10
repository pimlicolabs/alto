import { MinMaxQueue } from "../utils/slidingWindowTimedQueue"

export class OptimismManager {
    private l1FeeQueue: MinMaxQueue

    constructor(queueValidity: number) {
        this.l1FeeQueue = new MinMaxQueue(queueValidity)
    }

    public getMinL1Fee() {
        return this.l1FeeQueue.getMinValue() || 1n
    }

    public saveL1FeeValue(l1Fee: bigint) {
        this.l1FeeQueue.saveValue(l1Fee)
    }
}
