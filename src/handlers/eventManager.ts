import Redis from "ioredis"
import type { Hex } from "viem"
import type { OpEventType } from "../types/schemas"

export class EventManager {
    private redis: Redis | undefined
    private chainId: number

    constructor(endpoint: string | undefined, chainId: number) {
        this.chainId = chainId

        if (endpoint) {
            this.redis = new Redis(endpoint)
            return
        }

        this.redis = undefined
    }

    async emitEvent(
        userOperationHash: Hex,
        event: OpEventType,
        timestamp?: number
    ) {
        if (!this.redis) {
            return
        }

        const response = {
            userOperationHash,
            timestamp: timestamp ?? Date.now(),
            chainId: this.chainId,
            ...event
        }

        // log to redis here
        await this.redis.lpush(
            "UserOperationStatusEventsQueue",
            JSON.stringify(response)
        )
    }
}
