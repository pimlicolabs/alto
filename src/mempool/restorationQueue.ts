import type { Address, UserOpInfo } from "@alto/types"
import type { Logger } from "@alto/utils"
import Bull, { type Queue, type Job } from "bull"
import Redis from "ioredis"

export interface MempoolRestorationData {
    type: "MEMPOOL_DATA"
    chainId: number
    entryPoint: Address
    data: {
        outstanding: UserOpInfo[]
        submitted: UserOpInfo[]
        processing: UserOpInfo[]
    }
    timestamp: number
}

export interface MempoolRestorationEnd {
    type: "END_RESTORATION"
    chainId: number
    timestamp: number
}

export type MempoolRestorationMessage =
    | MempoolRestorationData
    | MempoolRestorationEnd

export class MempoolRestorationQueue {
    private queue: Queue<MempoolRestorationMessage>
    private logger: Logger
    private chainId: number

    constructor(redisUrl: string, chainId: number, logger: Logger) {
        this.chainId = chainId
        this.logger = logger

        let client: Redis
        let subscriber: Redis

        this.queue = new Bull<MempoolRestorationMessage>(
            `alto:mempool:restoration:${chainId}`,
            {
                createClient: (type, redisOpts) => {
                    switch (type) {
                        case "client": {
                            if (!client) {
                                client = new Redis(redisUrl, {
                                    ...redisOpts,
                                    enableReadyCheck: false,
                                    maxRetriesPerRequest: null
                                })
                            }
                            return client
                        }
                        case "subscriber": {
                            if (!subscriber) {
                                subscriber = new Redis(redisUrl, {
                                    ...redisOpts,
                                    enableReadyCheck: false,
                                    maxRetriesPerRequest: null
                                })
                            }
                            return subscriber
                        }
                        case "bclient":
                            return new Redis(redisUrl, {
                                ...redisOpts,
                                enableReadyCheck: false,
                                maxRetriesPerRequest: null
                            })
                        default:
                            throw new Error(
                                `Unexpected connection type: ${type}`
                            )
                    }
                }
            }
        )

        this.queue.on("error", (error) => {
            this.logger.error({ error }, "[MEMPOOL-RESTORATION] Queue error")
        })

        // Set up connection error handling
        this.queue.on("failed", (job, err) => {
            this.logger.error(
                { jobId: job?.id, err },
                "[MEMPOOL-RESTORATION] Queue job failed"
            )
        })
    }

    async publishMempoolData(
        entryPoint: Address,
        data: {
            outstanding: UserOpInfo[]
            submitted: UserOpInfo[]
            processing: UserOpInfo[]
        }
    ): Promise<void> {
        try {
            await this.queue.add({
                type: "MEMPOOL_DATA",
                chainId: this.chainId,
                entryPoint,
                data,
                timestamp: Date.now()
            })
        } catch (err) {
            this.logger.error(
                { err, entryPoint },
                "[MEMPOOL-RESTORATION] Failed to publish mempool data"
            )
            throw err
        }
    }

    async publishEndRestoration(): Promise<void> {
        try {
            await this.queue.add({
                type: "END_RESTORATION",
                chainId: this.chainId,
                timestamp: Date.now()
            })
        } catch (err) {
            this.logger.error(
                { err },
                "[MEMPOOL-RESTORATION] Failed to publish END_RESTORATION message"
            )
            throw err
        }
    }

    async process(
        handler: (job: Job<MempoolRestorationMessage>) => Promise<void>
    ): Promise<void> {
        await this.queue.process(handler)
    }

    async close(): Promise<void> {
        await this.queue.close()
    }

    async pause(): Promise<void> {
        await this.queue.pause(true)
    }

    async resume(): Promise<void> {
        await this.queue.resume()
    }
}
