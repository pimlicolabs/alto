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

const outstandingQueueName = "outstanding-mempool"

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
}: { config: AltoConfig; metrics: Metrics }): Store => {
    const { redisMempoolUrl } = config

    if (!redisMempoolUrl) {
        throw new Error("Redis mempool URL is not set")
    }

    const outstandingQueue = createQueue<UserOperationInfo>(
        redisMempoolUrl,
        outstandingQueueName
    )

    const memoryStore = createMemoryStore({ config, metrics })

    return {
        process: ({ maxTime, maxGasLimit }, callback) => {
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

            outstandingQueue.process(
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
        addOutstanding: async (op) => {
            await outstandingQueue.add(op)
        },
        addProcessing: async (op) => {
            await memoryStore.addProcessing(op)
        },
        addSubmitted: async (op) => {
            await memoryStore.addSubmitted(op)
        },
        removeOutstanding: async (userOpHash) => {
            const jobs = await outstandingQueue.getWaiting()

            const job = jobs.find(
                (job) => job.data.userOperationHash === userOpHash
            )

            if (job) {
                await job.remove()
            }
        },
        removeProcessing: async (userOpHash) => {
            await memoryStore.removeProcessing(userOpHash)
        },
        removeSubmitted: async (userOpHash) => {
            await memoryStore.removeSubmitted(userOpHash)
        },
        dumpOutstanding: async () => {
            const awaitingJobs = await outstandingQueue.getWaiting()

            return awaitingJobs.map((job) => job.data)
        },
        dumpProcessing: () => {
            return memoryStore.dumpProcessing()
        },
        dumpSubmitted: () => {
            return memoryStore.dumpSubmitted()
        },
        clear: async (from) => {
            if (from === "outstanding") {
                await outstandingQueue.clean(0, "active")
            } else {
                await memoryStore.clear(from)
            }
        }
    }
}
