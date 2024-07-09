import Redis from "ioredis"
import type { Hex } from "viem"
import type { OpEventType } from "../types/schemas"
// biome-ignore lint/style/noNamespaceImport: explicitly make it clear when sentry is used
import * as sentry from "@sentry/node"
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

    // emits when the userOperation was mined onchain but failed
    async emitFailedOnChain(userOperationHash: Hex, transactionHash: Hex) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "failed_onchain",
                transactionHash
            }
        })
    }

    // emits when the userOperation has been included onchain but bundled by a frontrunner
    async emitFrontranOnChain(userOperationHash: Hex, transactionHash: Hex) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "frontran_onchain",
                transactionHash
            }
        })
    }

    // emits when the userOperation is included onchain
    async emitIncludedOnChain(
        userOperationHash: Hex,
        transactionHash: Hex,
        timestamp: number
    ) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "included_onchain",
                transactionHash
            },
            timestamp
        })
    }

    // emits when the userOperation is placed in the nonce queue
    async emitQueued(userOperationHash: Hex) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "queued"
            }
        })
    }

    // emits when the userOperation is first seen
    async emitReceived(userOperationHash: Hex, timestamp?: number) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "received"
            },
            timestamp
        })
    }

    // emits when the userOperation failed to get added to the mempool
    async emitFailedValidation(
        userOperationHash: Hex,
        reason?: string,
        aaError?: string
    ) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "failed_validation",
                data: {
                    reason,
                    aaError
                }
            }
        })
    }

    // emits when the userOperation has been submitted to the network
    async emitSubmitted(userOperationHash: Hex, transactionHash: Hex) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "submitted",
                transactionHash
            }
        })
    }

    // emits when the userOperation was dropped from the internal mempool
    async emitDropped(
        userOperationHash: Hex,
        reason?: string,
        aaError?: string
    ) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "dropped",
                data: {
                    reason,
                    aaError
                }
            }
        })
    }

    // emits when the userOperation was added to the internal mempool
    async emitAddedToMempool(userOperationHash: Hex) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "added_to_mempool"
            }
        })
    }

    private async emitEvent({
        userOperationHash,
        event,
        timestamp
    }: {
        userOperationHash: Hex
        event: OpEventType
        timestamp?: number
    }) {
        if (!this.redis) {
            return
        }

        const entry = {
            userOperationHash,
            eventTimestamp: timestamp ?? Date.now(),
            chainId: this.chainId,
            ...event
        }

        // log to redis here
        try {
            await this.redis.lpush(
                "UserOperationStatusEventsQueue",
                JSON.stringify(entry)
            )
        } catch (e) {
            this.logger.error(
                "Failed to send userOperation status event due to ",
                JSON.stringify(e)
            )
            sentry.captureException(e)
        }
    }
}
