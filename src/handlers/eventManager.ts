// biome-ignore lint/style/noNamespaceImport: explicitly make it clear when sentry is used
import * as sentry from "@sentry/node"
import Redis from "ioredis"
import type { Hex } from "viem"
import type { OpEventType } from "../types/schemas"
import type { Logger, Metrics } from "@alto/utils"

export class EventManager {
    private redis: Redis | undefined
    private chainId: number
    private logger: Logger
    private metrics: Metrics

    constructor(
        endpoint: string | undefined,
        chainId: number,
        logger: Logger,
        metrics: Metrics
    ) {
        this.chainId = chainId
        this.logger = logger
        this.metrics = metrics

        if (endpoint) {
            this.redis = new Redis(endpoint)
            return
        }

        this.redis = undefined
    }

    // emits when the userOperation was mined onchain but failed
    async emitFailedOnChain(
        userOperationHash: Hex,
        transactionHash: Hex,
        blockNumber: bigint
    ) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "failed_onchain",
                transactionHash,
                data: {
                    blockNumber
                }
            }
        })
    }

    // emits when the userOperation has been included onchain but bundled by a frontrunner
    async emitFrontranOnChain(
        userOperationHash: Hex,
        transactionHash: Hex,
        blockNumber: bigint
    ) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "frontran_onchain",
                transactionHash,
                data: {
                    blockNumber
                }
            }
        })
    }

    // emits when the userOperation is included onchain
    async emitIncludedOnChain(
        userOperationHash: Hex,
        transactionHash: Hex,
        blockNumber: bigint
    ) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "included_onchain",
                transactionHash,
                data: {
                    blockNumber
                }
            }
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
        let lpushStatus: string
        try {
            await this.redis.lpush(
                "UserOperationStatusEventsQueue",
                JSON.stringify(entry)
            )
            lpushStatus = "success"
        } catch (e) {
            this.logger.error(
                "Failed to send userOperation status event due to ",
                JSON.stringify(e)
            )
            sentry.captureException(e)
            lpushStatus = "failed"
        }

        this.metrics.emittedOpEvents
            .labels({
                // biome-ignore lint/style/useNamingConvention: event_type
                event_type: event.eventType,
                status: lpushStatus
            })
            .inc()
    }
}
