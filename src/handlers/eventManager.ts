import type { Logger, Metrics } from "@alto/utils"
import * as sentry from "@sentry/node"
import Redis from "ioredis"
import type { Hex } from "viem"
import type { OpEventType } from "../types/schemas"
import type { AltoConfig } from "../createConfig"

export class EventManager {
    private chainId: number
    private redis: Redis | undefined
    private logger: Logger
    private metrics: Metrics

    constructor({
        config,
        metrics
    }: {
        config: AltoConfig
        metrics: Metrics
    }) {
        this.chainId = config.publicClient.chain.id

        this.logger = config.getLogger(
            { module: "event_manager" },
            {
                level: config.logLevel
            }
        )
        this.metrics = metrics

        if (config.redisQueueEndpoint) {
            this.redis = new Redis(config.redisQueueEndpoint)
            return
        }

        this.redis = undefined
    }

    // emits when the userOperation was mined onchain but reverted during the callphase
    async emitExecutionRevertedOnChain(
        userOperationHash: Hex,
        transactionHash: Hex,
        reason: Hex,
        blockNumber: bigint
    ) {
        await this.emitEvent({
            userOperationHash,
            event: {
                eventType: "execution_reverted_onchain",
                transactionHash,
                data: {
                    blockNumber: Number(blockNumber),
                    reason
                }
            }
        })
    }

    // emits when the userOperation was mined onchain but failed EntryPoint validation
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
                    blockNumber: Number(blockNumber)
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
                    blockNumber: Number(blockNumber)
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
                    blockNumber: Number(blockNumber)
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
