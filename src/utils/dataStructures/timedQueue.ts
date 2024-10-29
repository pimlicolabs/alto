import { minBigInt, maxBigInt } from "../bigInt"

export class TimedQueue {
    private queue: { timestamp: number; value: bigint }[]
    private maxQueueSize: number
    private queueValidity: number

    constructor(maxQueueSize: number, queueValidity: number) {
        this.queue = []
        this.maxQueueSize = maxQueueSize
        this.queueValidity = queueValidity
    }

    public saveValue(value: bigint) {
        if (value === 0n) {
            return
        }

        const last = this.queue[this.queue.length - 1]
        const timestamp = Date.now()

        if (!last || timestamp - last.timestamp >= this.queueValidity) {
            if (this.queue.length >= this.maxQueueSize) {
                this.queue.shift()
            }
            this.queue.push({ value, timestamp })
        } else if (value < last.value) {
            last.value = value
            last.timestamp = timestamp
        }
    }

    public getLatestValue(): bigint | null {
        if (this.queue.length === 0) {
            return null
        }
        return this.queue[this.queue.length - 1].value
    }

    public getMinValue() {
        if (this.queue.length === 0) {
            return undefined
        }

        return this.queue.reduce(
            (acc, cur) => minBigInt(cur.value, acc),
            this.queue[0].value
        )
    }

    public getMaxValue() {
        if (this.queue.length === 0) {
            return undefined
        }

        return this.queue.reduce(
            (acc, cur) => maxBigInt(cur.value, acc),
            this.queue[0].value
        )
    }

    public isEmpty(): boolean {
        return this.queue.length === 0
    }
}
