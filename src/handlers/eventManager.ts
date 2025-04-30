import type { Logger, Metrics } from "@alto/utils"
import * as sentry from "@sentry/node"
import Redis from "ioredis"
import type { Hex } from "viem"
import type { OpEventType } from "../types/schemas"
import type { AltoConfig } from "../createConfig"
import Queue, { type Queue as QueueType } from "bull"
import { asyncCallWithTimeout, AsyncTimeoutError } from "../utils/asyncTimeout"

type QueueMessage = OpEventType & {
    userOperationHash: Hex
    eventTimestamp: number
    chainId: number
}

export class EventManager {
    private chainId: number
    private logger: Logger
    private metrics: Metrics
    private redisEventManagerQueue?: QueueType<QueueMessage>

    constructor({
        config,
        metrics
    }: {
        config: AltoConfig
        metrics: Metrics
    }) {
        this.chainId = config.chainId

        this.logger = config.getLogger(
            { module: "event_manager" },
            {
                level: config.logLevel
            }
        )
        this.metrics = metrics

        if (config.redisQueueEndpoint && config.redisEventManagerQueueName) {
            this.logger.info(
                `Using redis with queue name ${config.redisEventManagerQueueName} for userOp event queue`
            )
            const redis = new Redis(config.redisQueueEndpoint)

            this.redisEventManagerQueue = new Queue<QueueMessage>(
                config.redisEventManagerQueueName,
                {
                    createClient: () => {
                        return redis
                    }
                }
            )
            return
        }
    }

    // emits when the userOperation was mined onchain but reverted during the callphase
    emitExecutionRevertedOnChain(
        userOperationHash: Hex,
        transactionHash: Hex,
        reason: Hex,
        blockNumber: bigint
    ) {
        this.emitEvent({
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
    emitFailedOnChain(
        userOperationHash: Hex,
        transactionHash: Hex,
        blockNumber: bigint
    ) {
        this.emitEvent({
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
    emitFrontranOnChain(
        userOperationHash: Hex,
        transactionHash: Hex,
        blockNumber: bigint
    ) {
        this.emitEvent({
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
    emitIncludedOnChain(
        userOperationHash: Hex,
        transactionHash: Hex,
        blockNumber: bigint
    ) {
        this.emitEvent({
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
    emitQueued(userOperationHash: Hex) {
        this.emitEvent({
            userOperationHash,
            event: {
                eventType: "queued"
            }
        })
    }

    // emits when the userOperation is first seen
    emitReceived(userOperationHash: Hex, timestamp?: number) {
        this.emitEvent({
            userOperationHash,
            event: {
                eventType: "received"
            },
            timestamp
        })
    }

    // emits when the userOperation failed to get added to the mempool
    emitFailedValidation(
        userOperationHash: Hex,
        reason?: string,
        aaError?: string
    ) {
        this.emitEvent({
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
    emitSubmitted({
        userOpHashes,
        transactionHash
    }: { userOpHashes: Hex[]; transactionHash: Hex }) {
        for (const hash of userOpHashes) {
            this.emitEvent({
                userOperationHash: hash,
                event: {
                    eventType: "submitted",
                    transactionHash
                }
            })
        }
    }

    // emits when the userOperation was dropped from the internal mempool
    emitDropped(
        userOperationHash: Hex,
        reason?: string,
        aaError?: string
    ) {
        this.emitEvent({
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
    emitAddedToMempool(userOperationHash: Hex) {
        this.emitEvent({
            userOperationHash,
            event: {
                eventType: "added_to_mempool"
            }
        })
    }

    private emitEvent({
        userOperationHash,
        event,
        timestamp
    }: {
        userOperationHash: Hex
        event: OpEventType
        timestamp?: number
    }) {
        if (!this.redisEventManagerQueue) {
            return
        }

        const entry = {
            userOperationHash,
            eventTimestamp: timestamp ?? Date.now(),
            chainId: this.chainId,
            ...event
        }

        this.emitWithTimeout(entry, event.eventType)
    }

    private emitWithTimeout(entry: QueueMessage, eventType: string) {
        asyncCallWithTimeout(
            this.redisEventManagerQueue!.add(entry, {
                removeOnComplete: true,
                removeOnFail: true
            }),
            500 // 500ms timeout
        )
            .then(() => {
                this.metrics.emittedOpEvents
                    .labels({
                        event_type: eventType,
                        status: "success"
                    })
                    .inc()
            })
            .catch((err) => {
                if (err instanceof AsyncTimeoutError) {
                    this.logger.warn(
                        { userOpHash: entry.userOperationHash, eventType },
                        "Event emission timed out after 500ms"
                    )
                    this.metrics.emittedOpEvents
                        .labels({
                            event_type: eventType,
                            status: "timeout"
                        })
                        .inc()
                } else {
                    this.logger.error(
                        { err },
                        "Failed to send userOperation status event"
                    )
                    sentry.captureException(err)
                    this.metrics.emittedOpEvents
                        .labels({
                            event_type: eventType,
                            status: "failed"
                        })
                        .inc()
                }
            })
    }
}
