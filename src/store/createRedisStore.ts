import { createMemoryStore, type Store } from "@alto/store"
import type { AltoConfig } from "@alto/config"
import type { Metrics } from "@alto/utils"
import { Redis } from "ioredis"
import Queue from "bull"
import {
    deriveUserOperation,
    userOperationInfoSchema,
    type UserOperationInfo
} from "@alto/types"

const outstandingQueueName = "outstanding-mempool-v2"

const createQueue = <T>(url: string, queueName: string) => {
    let client: Redis
    let subscriber: Redis

    return new Queue<T>(queueName, {
        createClient: (type, redisOpts) => {
            switch (type) {
                case "client": {
                    if (!client) {
                        client = new Redis(url, {
                            ...redisOpts,
                            enableReadyCheck: false,
                            maxRetriesPerRequest: null
                        })
                    }
                    return client
                }
                case "subscriber": {
                    if (!subscriber) {
                        subscriber = new Redis(url, {
                            ...redisOpts,
                            enableReadyCheck: false,
                            maxRetriesPerRequest: null
                        })
                    }
                    return subscriber
                }
                case "bclient":
                    return new Redis(url, {
                        ...redisOpts,
                        enableReadyCheck: false,
                        maxRetriesPerRequest: null
                    })
                default:
                    throw new Error(`Unexpected connection type: ${type}`)
            }
        }
    })
}

export const createRedisStore = ({
    config,
    metrics
}: { config: AltoConfig; metrics: Metrics }): Store<{
    outstandingQueue: Queue.Queue<UserOperationInfo>
    memoryStore: Store
}> => {
    const { redisMempoolUrl } = config

    const logger = config.getLogger({
        module: "redisStore"
    })

    if (!redisMempoolUrl) {
        throw new Error("Redis mempool URL is not set")
    }

    return {
        outstandingQueue: createQueue<UserOperationInfo>(
            redisMempoolUrl,
            outstandingQueueName
        ),
        memoryStore: createMemoryStore({ config, metrics }),
        process({ maxTime, maxGasLimit }, callback) {
            let outstandingOps: UserOperationInfo[] = []
            let gasUsed = 0n

            const processOutstandingOps = () => {
                if (outstandingOps.length > 0) {
                    callback([...outstandingOps])
                    outstandingOps = []
                    gasUsed = 0n
                }
            }

            let interval = setInterval(processOutstandingOps, maxTime)

            this.outstandingQueue.process(
                config.redisMempoolConcurrency,
                (job, done) => {
                    const opInfo = userOperationInfoSchema.parse(job.data)

                    const op = deriveUserOperation(opInfo.mempoolUserOperation)

                    gasUsed +=
                        op.callGasLimit +
                        op.verificationGasLimit * 3n +
                        op.preVerificationGas

                    if (gasUsed > maxGasLimit) {
                        clearInterval(interval)
                        callback([...outstandingOps])

                        outstandingOps = []
                        gasUsed = 0n

                        interval = setInterval(processOutstandingOps, maxTime)
                    }

                    outstandingOps.push(opInfo)
                    done()
                }
            )

            return () => clearInterval(interval)
        },
        async addOutstanding(op) {
            logger.debug(
                { userOpHash: op.userOperationHash, store: "outstanding" },
                "added user op to mempool"
            )
            metrics.userOperationsInMempool
                .labels({
                    status: "outstanding"
                })
                .inc()
            await this.outstandingQueue.add(op)
        },
        async addProcessing(op) {
            await this.memoryStore.addProcessing(op)
        },
        async addSubmitted(op) {
            await this.memoryStore.addSubmitted(op)
        },
        async removeOutstanding(userOpHash) {
            const jobs = await this.outstandingQueue.getWaiting()

            const job = jobs.find((job) => {
                const parsedData = userOperationInfoSchema.parse(job.data)

                return parsedData.userOperationHash === userOpHash
            })

            if (job) {
                await job.remove()
                logger.debug(
                    { userOpHash, store: "outstanding" },
                    "removed user op from mempool"
                )
                metrics.userOperationsInMempool
                    .labels({
                        status: "outstanding"
                    })
                    .dec()
            } else {
                logger.warn(
                    { userOpHash, store: "outstanding" },
                    "tried to remove non-existent user op from mempool"
                )
            }
        },
        async removeProcessing(userOpHash) {
            await this.memoryStore.removeProcessing(userOpHash)
        },
        async removeSubmitted(userOpHash) {
            await this.memoryStore.removeSubmitted(userOpHash)
        },
        async dumpOutstanding() {
            const awaitingJobs = await this.outstandingQueue.getWaiting()

            logger.trace(
                {
                    store: "outstanding",
                    length: awaitingJobs.length
                },
                "dumping mempool"
            )

            return awaitingJobs.map((job) => {
                return userOperationInfoSchema.parse(job.data)
            })
        },
        dumpProcessing() {
            return this.memoryStore.dumpProcessing()
        },
        dumpSubmitted() {
            return this.memoryStore.dumpSubmitted()
        },
        async clear(from) {
            if (from === "outstanding") {
                logger.debug({ store: from }, "clearing mempool")
                await this.outstandingQueue.clean(0, "active")
            } else {
                await this.memoryStore.clear(from)
            }
        }
    }
}
