export class SlidingWindowTimedQueue {
    // Element 0 will always be the min.
    private minDeque: { timestamp: number; value: bigint }[]
    // Element 0 will always be the max.
    private maxDeque: { timestamp: number; value: bigint }[]
    private latestValue: bigint | null
    private queueValidityMs: number

    constructor(queueValidityMs: number) {
        this.minDeque = []
        this.maxDeque = []
        this.latestValue = null
        this.queueValidityMs = queueValidityMs
    }

    public saveValue(value: bigint) {
        if (value === 0n) {
            return
        }

        const timestamp = Date.now()

        // Remove expired entries.
        const cutoffTime = timestamp - this.queueValidityMs
        this.minDeque = this.minDeque.filter(
            (entry) => entry.timestamp >= cutoffTime
        )
        this.maxDeque = this.maxDeque.filter(
            (entry) => entry.timestamp >= cutoffTime
        )

        // Maintain the min deque by removing all elements from the back that are larger then the new value.
        while (
            this.minDeque.length &&
            this.minDeque[this.minDeque.length - 1].value >= value
        ) {
            this.minDeque.pop()
        }
        this.minDeque.push({ value, timestamp })

        // Maintain the max deque by removing all elements from the back that are smaller then the new value.
        while (
            this.maxDeque.length &&
            this.maxDeque[this.maxDeque.length - 1].value <= value
        ) {
            this.maxDeque.pop()
        }
        this.maxDeque.push({ value, timestamp })

        // Record the latest value.
        this.latestValue = value
    }

    public getLatestValue(): bigint | null {
        return this.latestValue
    }

    public getMinValue() {
        return this.minDeque.length ? this.minDeque[0].value : null
    }

    public getMaxValue() {
        return this.maxDeque.length ? this.maxDeque[0].value : null
    }
}
