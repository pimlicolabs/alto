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
    }

    async publishMempoolData(
        entryPoint: Address,
        data: {
            outstanding: UserOpInfo[]
            submitted: UserOpInfo[]
            processing: UserOpInfo[]
        }
    ): Promise<void> {
        await this.queue.add({
            type: "MEMPOOL_DATA",
            chainId: this.chainId,
            entryPoint,
            data,
            timestamp: Date.now()
        })
    }

    async publishEndRestoration(): Promise<void> {
        await this.queue.add({
            type: "END_RESTORATION",
            chainId: this.chainId,
            timestamp: Date.now()
        })
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

    async checkActiveListeners(): Promise<boolean> {
        const workers = await this.queue.getWorkers()
        return workers.length > 0
    }

    async waitForNoActiveListeners(timeoutMs = 30000): Promise<void> {
        const startTime = Date.now()
        while (await this.checkActiveListeners()) {
            if (Date.now() - startTime > timeoutMs) {
                throw new Error("Timeout waiting for listeners to stop")
            }
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }
    }
}
