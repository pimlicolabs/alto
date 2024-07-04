import Redis from "ioredis"
import type { Hex } from "viem"
import type { OpEventType } from "../types/schemas"

export class EventManager {
    private redis: Redis | undefined

    constructor(endpoint: string | undefined) {
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
            ...event,
            timestamp: timestamp ?? Date.now()
        }

        // log to redis here
        await this.redis.lpush(userOperationHash, JSON.stringify(response))
    }
}
