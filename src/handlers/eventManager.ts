import { asyncCallWithTimeout, type Logger } from "@alto/utils"
import * as sentry from "@sentry/node"
import Queue, { type Queue as QueueType } from "bull"
import Redis from "ioredis"
import type { Hex } from "viem"
import type { AltoConfig } from "../createConfig"
import type { OpEventType } from "../types/schemas"

type QueueMessage = OpEventType & {
    userOperationHash: Hex
    eventTimestamp: number
    chainId: number
}

export class EventManager {
    private readonly chainId: number
    private readonly logger: Logger
    private readonly redisEventManagerQueue?: QueueType<QueueMessage>
    private readonly eventBuffer: QueueMessage[] = []
    private readonly flushInterval: number
    private flushTimer?: NodeJS.Timeout

    constructor({
        config
    }: {
        config: AltoConfig
    }) {
        this.chainId = config.chainId
        this.flushInterval = config.redisEventsQueueFlushInterval

        this.logger = config.getLogger(
            { module: "event_manager" },
            {
                level: config.logLevel
            }
        )

        if (config.redisEventsQueueEndpoint && config.redisEventsQueueName) {
            const queueName = config.redisEventsQueueName
            this.logger.info(
                `Using redis with queue name ${queueName} for userOp event queue (flush interval: ${this.flushInterval}ms)`
            )
            const redis = new Redis(config.redisEventsQueueEndpoint)

            this.redisEventManagerQueue = new Queue<QueueMessage>(queueName, {
                createClient: () => {
                    return redis
                },
                defaultJobOptions: {
                    attempts: 3,
                    backoff: {
                        type: "fixed",
                        delay: 30000
                    },
                    removeOnComplete: true,
                    removeOnFail: true
                }
            })

            this.startFlushTimer()
        }
    }

    private startFlushTimer() {
        this.flushTimer = setInterval(() => {
            this.flushEvents()
        }, this.flushInterval)

        // Ensure the timer doesn't prevent the process from exiting
        this.flushTimer.unref()
    }

    private flushEvents() {
        if (!this.redisEventManagerQueue || this.eventBuffer.length === 0) {
            return
        }

        const eventsToFlush = this.eventBuffer.splice(0)
        const eventCount = eventsToFlush.length

        // Fire and forget - don't block the timer
        asyncCallWithTimeout(
            this.redisEventManagerQueue.addBulk(
                eventsToFlush.map((entry) => ({ data: entry }))
            ),
            500
        ).catch((err) => {
            this.logger.error(
                { err, eventCount },
                "Failed to flush events to Redis"
            )
            sentry.captureException(err)
        })
    }

    // emits when the userOperation was mined onchain but reverted during the callphase
    emitExecutionRevertedOnChain(
        userOpHash: Hex,
        transactionHash: Hex,
        reason: Hex,
        blockNumber: bigint
    ) {
        this.queueEvent({
            userOpHash,
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
        userOpHash: Hex,
        transactionHash: Hex,
        blockNumber: bigint
    ) {
        this.queueEvent({
            userOpHash,
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
        userOpHash: Hex,
        transactionHash: Hex,
        blockNumber: bigint
    ) {
        this.queueEvent({
            userOpHash,
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
        userOpHash: Hex,
        transactionHash: Hex,
        blockNumber: bigint
    ) {
        this.queueEvent({
            userOpHash,
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
    emitQueued(userOpHash: Hex) {
        this.queueEvent({
            userOpHash,
            event: {
                eventType: "queued"
            }
        })
    }

    // emits when the userOperation is first seen
    emitReceived(userOpHash: Hex, timestamp?: number) {
        this.queueEvent({
            userOpHash,
            event: {
                eventType: "received"
            },
            timestamp
        })
    }

    // emits when the userOperation failed to get added to the mempool
    emitFailedValidation(userOpHash: Hex, reason?: string, aaError?: string) {
        this.queueEvent({
            userOpHash,
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
            this.queueEvent({
                userOpHash: hash,
                event: {
                    eventType: "submitted",
                    transactionHash
                }
            })
        }
    }

    // emits when the userOperation was dropped from the internal mempool
    emitDropped(userOpHash: Hex, reason?: string, aaError?: string) {
        this.queueEvent({
            userOpHash,
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
    emitAddedToMempool(userOpHash: Hex) {
        this.queueEvent({
            userOpHash,
            event: {
                eventType: "added_to_mempool"
            }
        })
    }

    private queueEvent({
        userOpHash,
        event,
        timestamp
    }: {
        userOpHash: Hex
        event: OpEventType
        timestamp?: number
    }) {
        if (!this.redisEventManagerQueue) {
            return
        }

        const entry: QueueMessage = {
            userOperationHash: userOpHash,
            eventTimestamp: timestamp ?? Date.now(),
            chainId: this.chainId,
            ...event
        }

        this.eventBuffer.push(entry)
    }
}
