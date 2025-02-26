import { Logger, Metrics } from "@alto/utils"
import { AltoConfig } from "../createConfig"
import { Store, createMemoryStore } from "."
import { UserOpInfo, SubmittedUserOp } from "../types/mempool"
import { HexData32, userOperationSchema } from "../types/schemas"
import Queue, { type Queue as QueueType } from "bull"
import Redis from "ioredis"

const createQueue = <T>({
    url,
    queueName
}: { url: string; queueName: string; chainId: number }) => {
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

const addOutstanding = async ({
    userOpInfo,
    logger,
    metrics,
    outstanding
}: {
    userOpInfo: UserOpInfo
    logger: Logger
    metrics: Metrics
    outstanding: QueueType<UserOpInfo>
}) => {
    logger.debug(
        { userOpHash: userOpInfo.userOpHash, store: "outstanding" },
        "added user op to mempool"
    )
    metrics.userOperationsInMempool
        .labels({
            status: "outstanding"
        })
        .inc()
    outstanding.add(userOpInfo)
}

const removeOutstanding = async ({
    userOpHash,
    logger,
    metrics,
    outstanding
}: {
    userOpHash: HexData32
    logger: Logger
    metrics: Metrics
    outstanding: QueueType<UserOpInfo>
}) => {
    const jobs = await outstanding.getWaiting()
    const job = jobs.find((job) => job && job.data.userOpHash === userOpHash)

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
            {
                userOpHash,
                store: "outstanding"
            },
            "tried to remove non-existent user op from mempool"
        )
    }
}

const dumpOutstanding = async ({
    outstanding,
    logger
}: {
    outstanding: QueueType<UserOpInfo>
    logger: Logger
}) => {
    const awaitingJobs = await outstanding.getWaiting()

    logger.trace(
        {
            store: "outstanding",
            length: awaitingJobs.length
        },
        "dumping mempool"
    )

    return awaitingJobs
        .map((job) => {
            // job has already been removed from the queue.
            if (!job) {
                return undefined
            }

            return {
                ...job.data,
                // userOp contains bigint fields, so we use zod to serialize/parse
                userOp: userOperationSchema.parse(job.data.userOp)
            }
        })
        .filter((op): op is UserOpInfo => op !== undefined)
}

export const createRedisStore = ({
    config,
    metrics
}: { config: AltoConfig; metrics: Metrics }): Store => {
    const logger = config.getLogger(
        { module: "redis-store" },
        {
            level: config.logLevel
        }
    )

    const { redisMempoolUrl, redisMempoolQueueName } = config
    if (!redisMempoolUrl || !redisMempoolQueueName) {
        throw new Error(
            "Redis mempool URL or redis mempool queueName is not configured"
        )
    }

    const memoryStore = createMemoryStore({ config, metrics })
    const queueName = `${config.chainId}:${redisMempoolQueueName}`
    const outstanding: QueueType<UserOpInfo> = createQueue({
        url: redisMempoolUrl,
        queueName: queueName,
        chainId: config.chainId
    })

    logger.info(`Created redis store with queueName: ${queueName}`)
    return {
        addOutstanding: async (userOpInfo: UserOpInfo) => {
            await addOutstanding({
                outstanding,
                userOpInfo,
                logger,
                metrics
            })
        },
        removeOutstanding: async (userOpHash: HexData32) => {
            await removeOutstanding({
                outstanding,
                userOpHash,
                logger,
                metrics
            })
        },
        dumpOutstanding: async () => {
            return dumpOutstanding({
                outstanding,
                logger
            })
        },
        clear: async (from: "outstanding" | "processing" | "submitted") => {
            if (from === "outstanding") {
                logger.debug({ store: from }, "clearing mempool")
                await outstanding.clean(0, "active")
            } else {
                await memoryStore.clear(from)
            }
        },

        // Memory store methods
        addProcessing: async (userOpInfo: UserOpInfo) => {
            await memoryStore.addProcessing(userOpInfo)
        },
        removeProcessing: async (userOpHash: HexData32) => {
            await memoryStore.removeProcessing(userOpHash)
        },
        dumpProcessing: async () => {
            return memoryStore.dumpProcessing()
        },
        addSubmitted: async (userOpInfo: SubmittedUserOp) => {
            await memoryStore.addSubmitted(userOpInfo)
        },
        removeSubmitted: async (userOpHash: HexData32) => {
            await memoryStore.removeSubmitted(userOpHash)
        },
        dumpSubmitted: async () => {
            return memoryStore.dumpSubmitted()
        },
        popNextOutstanding: async () => {
            throw new Error("Not implemented")
        }
    }
}
