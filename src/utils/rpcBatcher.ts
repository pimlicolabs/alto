import type { PublicClient } from "viem"

interface BatchRequest<T> {
    resolve: (value: T) => void
    reject: (error: any) => void
    request: () => Promise<T>
}

export class RpcBatcher {
    private batchQueue: BatchRequest<any>[] = []
    private batchTimeout: NodeJS.Timeout | null = null
    private readonly maxBatchSize: number
    private readonly batchDelayMs: number

    constructor(maxBatchSize = 10, batchDelayMs = 10) {
        this.maxBatchSize = maxBatchSize
        this.batchDelayMs = batchDelayMs
    }

    /**
     * Add a request to the batch queue
     */
    async addRequest<T>(request: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.batchQueue.push({ resolve, reject, request })

            if (this.batchQueue.length >= this.maxBatchSize) {
                this.processBatch()
            } else if (!this.batchTimeout) {
                this.batchTimeout = setTimeout(() => {
                    this.processBatch()
                }, this.batchDelayMs)
            }
        })
    }

    /**
     * Process all queued requests
     */
    private async processBatch(): Promise<void> {
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout)
            this.batchTimeout = null
        }

        const batch = this.batchQueue.splice(0, this.maxBatchSize)
        if (batch.length === 0) return

        // Execute all requests in parallel
        const results = await Promise.allSettled(
            batch.map((item) => item.request())
        )

        // Resolve/reject individual promises
        results.forEach((result, index) => {
            if (result.status === "fulfilled") {
                batch[index].resolve(result.value)
            } else {
                batch[index].reject(result.reason)
            }
        })
    }

    /**
     * Create a batched version of a function
     */
    static createBatchedFunction<TArgs extends any[], TResult>(
        fn: (...args: TArgs) => Promise<TResult>,
        options?: {
            maxBatchSize?: number
            batchDelayMs?: number
            getCacheKey?: (...args: TArgs) => string
        }
    ): (...args: TArgs) => Promise<TResult> {
        const batcher = new RpcBatcher(
            options?.maxBatchSize,
            options?.batchDelayMs
        )
        const cache = new Map<string, Promise<TResult>>()

        return async (...args: TArgs): Promise<TResult> => {
            const cacheKey =
                options?.getCacheKey?.(...args) ?? JSON.stringify(args)

            const cached = cache.get(cacheKey)
            if (cached !== undefined) {
                return cached
            }

            const promise = batcher.addRequest(() => fn(...args))
            cache.set(cacheKey, promise)

            // Clean up cache after resolution
            promise.finally(() => {
                setTimeout(() => cache.delete(cacheKey), 1000)
            })

            return promise
        }
    }
}

/**
 * Create batched versions of common RPC methods
 */
export function createBatchedRpcClient(client: PublicClient) {
    return {
        getBalance: RpcBatcher.createBatchedFunction(
            client.getBalance.bind(client),
            {
                getCacheKey: (args) =>
                    `${args.address}-${args.blockNumber ?? "latest"}`
            }
        ),
        getTransactionCount: RpcBatcher.createBatchedFunction(
            client.getTransactionCount.bind(client),
            {
                getCacheKey: (args) =>
                    `${args.address}-${args.blockTag ?? "latest"}`
            }
        ),
        getCode: RpcBatcher.createBatchedFunction(client.getCode.bind(client), {
            getCacheKey: (args) =>
                `${args.address}-${args.blockNumber ?? "latest"}`
        })
    }
}
