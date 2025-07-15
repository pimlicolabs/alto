import type { Address, UserOpInfo } from "@alto/types"
import type { Logger } from "@alto/utils"
import Bull, { type Queue, type Job } from "bull"

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

        this.queue = new Bull<MempoolRestorationMessage>(
            `alto:mempool:restoration:${chainId}`,
            redisUrl,
            {
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: false,
                    attempts: 3,
                    backoff: {
                        type: "fixed",
                        delay: 1000
                    }
                }
            }
        )

        this.queue.on("error", (error) => {
            this.logger.error({ error }, "Mempool restoration queue error")
        })

        // Set up connection error handling
        this.queue.on("failed", (job, err) => {
            this.logger.error({ jobId: job?.id, err }, "Queue job failed")
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
                "Failed to publish mempool data"
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
                "Failed to publish END_RESTORATION message"
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
        await this.queue.pause()
    }

    async resume(): Promise<void> {
        await this.queue.resume()
    }
}
