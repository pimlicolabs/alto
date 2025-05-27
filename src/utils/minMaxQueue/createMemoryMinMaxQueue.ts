import type { MinMaxQueue } from "."
import type { AltoConfig } from "../../createConfig"

type QueueEntry = { timestamp: number; value: bigint }

const updateQueues = (
    value: bigint,
    queueValidity: number,
    minDeque: QueueEntry[],
    maxDeque: QueueEntry[]
): { minDeque: QueueEntry[]; maxDeque: QueueEntry[]; timestamp: number } => {
    const timestamp = Date.now() / 1_000 // Turn timestamp into seconds
    const cutoffTime = timestamp - queueValidity

    // Remove expired entries
    const filteredMinDeque = minDeque.filter(
        (entry) => entry.timestamp >= cutoffTime
    )
    const filteredMaxDeque = maxDeque.filter(
        (entry) => entry.timestamp >= cutoffTime
    )

    // Maintain the min deque
    while (
        filteredMinDeque.length &&
        filteredMinDeque[filteredMinDeque.length - 1].value >= value
    ) {
        filteredMinDeque.pop()
    }
    filteredMinDeque.push({ value, timestamp })

    // Maintain the max deque
    while (
        filteredMaxDeque.length &&
        filteredMaxDeque[filteredMaxDeque.length - 1].value <= value
    ) {
        filteredMaxDeque.pop()
    }
    filteredMaxDeque.push({ value, timestamp })

    return {
        minDeque: filteredMinDeque,
        maxDeque: filteredMaxDeque,
        timestamp
    }
}

export const createMemoryMinMaxQueue = ({
    config
}: { config: AltoConfig }): MinMaxQueue => {
    const queueValidity = config.gasPriceExpiry

    // Element 0 will always be the min.
    let minDeque: QueueEntry[] = []
    // Element 0 will always be the max.
    let maxDeque: QueueEntry[] = []
    let latestValue: bigint | null = null

    return {
        saveValue: async (value: bigint) => {
            if (value === 0n) {
                return
            }

            const result = updateQueues(
                value,
                queueValidity,
                minDeque,
                maxDeque
            )
            minDeque = result.minDeque
            maxDeque = result.maxDeque
            latestValue = value
        },
        getLatestValue: async () => {
            return latestValue
        },
        getMinValue: async () => {
            return minDeque.length ? minDeque[0].value : null
        },
        getMaxValue: async () => {
            return maxDeque.length ? maxDeque[0].value : null
        }
    }
}
