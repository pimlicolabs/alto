import Redis from "ioredis"
import type { Hex } from "viem"
import type { OpEventType } from "../types/schemas"
import { captureException } from "@sentry/node"
import type { Logger } from "@alto/utils"

export class EventManager {
    private redis: Redis | undefined
    private chainId: number
    private logger: Logger

    constructor(endpoint: string | undefined, chainId: number, logger: Logger) {
        this.chainId = chainId
        this.logger = logger

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
            eventTimestamp: timestamp ?? Date.now(),
            chainId: this.chainId,
            ...event
        }

        // log to redis here
        try {
            await this.redis.lpush(
                "UserOperationStatusEventsQueue",
                JSON.stringify(response)
            )
        } catch (e) {
            this.logger.error(
                "Failed to send userOperation status event due to ",
                JSON.stringify(e)
            )
            captureException(e)
        }
    }
}
