import type { SenderManager, UserOpMonitor } from "@alto/executor"
import type { Mempool } from "@alto/mempool"
import {
    recoverableJsonParseWithBigint,
    recoverableJsonStringifyWithBigint
} from "@alto/utils"
import Queue from "bull"
import Redis from "ioredis"
import type { Logger } from "pino"
import type { AltoConfig } from "../createConfig"

const getQueueName = (chainId: number) => `alto:mempool:restoration:${chainId}`

async function dropAllOperationsOnShutdown({
    config,
    mempool,
    logger
}: { config: AltoConfig; mempool: Mempool; logger: Logger }) {
    await Promise.all(
        config.entrypoints.map(async (entryPoint) => {
            try {
                const [outstanding, submitted, processing] = await Promise.all([
                    mempool.dumpOutstanding(entryPoint),
                    mempool.dumpSubmittedOps(entryPoint),
                    mempool.dumpProcessing(entryPoint)
                ])

                const rejectedUserOps = [
                    ...outstanding.map((userOp) => ({
                        ...userOp,
                        reason: "shutdown"
                    })),
                    ...submitted.map((userOp) => ({
                        ...userOp,
                        reason: "shutdown"
                    })),
                    ...processing.map((userOp) => ({
                        ...userOp,
                        reason: "shutdown"
                    }))
                ]

                if (rejectedUserOps.length > 0) {
                    await mempool.dropUserOps(entryPoint, rejectedUserOps)
                }

                logger.info(
                    {
                        outstanding: outstanding.length,
                        submitted: submitted.length,
                        processing: processing.length
                    },
                    "[MEMPOOL-RESTORATION] Dropping mempool operations"
                )
            } catch (err) {
                logger.error(
                    { err, entryPoint },
                    "[MEMPOOL-RESTORATION] Failed to drop operations for entrypoint during shutdown"
                )
                // Continue with other entrypoints
            }
        })
    )
}

async function queueOperationsOnShutdownToRedis({
    mempool,
    userOpMonitor,
    config,
    logger
}: {
    mempool: Mempool
    userOpMonitor: UserOpMonitor
    config: AltoConfig
    logger: Logger
}) {
    if (!config.redisShutdownMempoolUrl) {
        return
    }
    try {
        const redis = new Redis(config.redisShutdownMempoolUrl)
        const queueName = getQueueName(config.publicClient.chain.id)
        const restorationQueue = new Queue(queueName, {
            createClient: () => {
                return redis
            }
        })

        logger.info(
            {
                queueName,
                chainId: config.publicClient.chain.id
            },
            "[MEMPOOL-RESTORATION] Publishing to restoration queue during shutdown"
        )
        // Publish mempool data to the queue
        await Promise.all(
            config.entrypoints.map(async (entryPoint) => {
                try {
                    const [outstanding, submitted, processing, pendingBundles] =
                        await Promise.all([
                            mempool.dumpOutstanding(entryPoint),
                            mempool.dumpSubmittedOps(entryPoint),
                            mempool.dumpProcessing(entryPoint),
                            userOpMonitor.getPendingBundles()
                        ])

                    if (
                        outstanding.length > 0 ||
                        submitted.length > 0 ||
                        processing.length > 0 ||
                        pendingBundles.length > 0
                    ) {
                        await restorationQueue.add({
                            type: "MEMPOOL_DATA",
                            chainId: config.publicClient.chain.id,
                            entryPoint,
                            data: recoverableJsonStringifyWithBigint({
                                outstanding,
                                submitted,
                                processing,
                                pendingBundles
                            }),
                            timestamp: Date.now()
                        })
                    }
                    logger.info(
                        {
                            entryPoint,
                            outstanding: outstanding.length,
                            submitted: submitted.length,
                            processing: processing.length
                        },
                        "[MEMPOOL-RESTORATION] Published mempool data to restoration queue"
                    )
                } catch (err) {
                    logger.error(
                        { err, entryPoint },
                        "[MEMPOOL-RESTORATION] Failed to publish mempool data for entrypoint, continuing"
                    )
                    // Continue with other entrypoints
                }
            })
        )

        await restorationQueue.add({
            type: "END_RESTORATION",
            chainId: config.publicClient.chain.id,
            timestamp: Date.now()
        })
        logger.info("[MEMPOOL-RESTORATION] Published END_RESTORATION message")

        await redis.quit()
    } catch (err) {
        logger.error(
            { err },
            "[MEMPOOL-RESTORATION] Unexpected error during queue-based shutdown, falling back to dropping operations"
        )
        // Fall back to dropping operations
        await dropAllOperationsOnShutdown({ mempool, logger, config })
    }
}

export function persistShutdownState({
    mempool,
    userOpMonitor,
    config,
    logger
}: {
    mempool: Mempool
    userOpMonitor: UserOpMonitor
    config: AltoConfig
    logger: Logger
}) {
    if (config.redisShutdownMempoolUrl) {
        return queueOperationsOnShutdownToRedis({
            mempool,
            userOpMonitor,
            config,
            logger
        })
    }

    // No queue configured, drop all operations
    return dropAllOperationsOnShutdown({ mempool, logger, config })
}

export async function restoreShutdownState({
    mempool,
    userOpMonitor,
    config,
    logger,
    senderManager
}: {
    mempool: Mempool
    userOpMonitor: UserOpMonitor
    config: AltoConfig
    logger: Logger
    senderManager: SenderManager
}) {
    const redisShutdownMempoolUrl = config.redisShutdownMempoolUrl
    if (!redisShutdownMempoolUrl) {
        return
    }
    let restorationTimeout: NodeJS.Timeout | null = null

    try {
        const queueName = getQueueName(config.publicClient.chain.id)

        let client: Redis
        let subscriber: Redis

        const restorationQueue = new Queue(queueName, {
            createClient: (type, redisOpts) => {
                switch (type) {
                    case "client": {
                        if (!client) {
                            client = new Redis(redisShutdownMempoolUrl, {
                                ...redisOpts,
                                enableReadyCheck: false,
                                maxRetriesPerRequest: null
                            })
                        }
                        return client
                    }
                    case "subscriber": {
                        if (!subscriber) {
                            subscriber = new Redis(redisShutdownMempoolUrl, {
                                ...redisOpts,
                                enableReadyCheck: false,
                                maxRetriesPerRequest: null
                            })
                        }
                        return subscriber
                    }
                    case "bclient":
                        return new Redis(redisShutdownMempoolUrl, {
                            ...redisOpts,
                            enableReadyCheck: false,
                            maxRetriesPerRequest: null
                        })
                    default:
                        throw new Error(`Unexpected connection type: ${type}`)
                }
            }
        })

        if (await restorationQueue.isPaused()) {
            await restorationQueue.resume()
        }

        const timeoutMs = config.restorationQueueTimeout || 30 * 60 * 1000
        restorationTimeout = setTimeout(async () => {
            logger.warn(
                { timeoutMs },
                "[MEMPOOL-RESTORATION] Mempool restoration timeout reached, stopping listener"
            )
            if (restorationTimeout) {
                clearTimeout(restorationTimeout)
            }
            await restorationQueue.close()
            await client.quit()
            await subscriber.quit()
        }, timeoutMs)

        await restorationQueue.process(1, async (job, done) => {
            try {
                logger.info(
                    {
                        jobId: job.id,
                        messageType: job.data.type,
                        timestamp: job.data.timestamp
                    },
                    "[MEMPOOL-RESTORATION] Processing restoration message"
                )

                const message = job.data

                if (message.type === "END_RESTORATION") {
                    logger.info(
                        "[MEMPOOL-RESTORATION] Received END_RESTORATION message, stopping listener"
                    )
                    if (restorationTimeout) {
                        clearTimeout(restorationTimeout)
                    }
                    await restorationQueue.close()
                    await client.quit()
                    await subscriber.quit()
                    return done()
                }

                if (message.type === "MEMPOOL_DATA") {
                    const { entryPoint } = message
                    const data = recoverableJsonParseWithBigint(message.data)
                    logger.info(
                        {
                            entryPoint,
                            outstanding: data.outstanding.length,
                            submitted: data.submitted.length,
                            processing: data.processing.length,
                            pendingBundles: data.pendingBundles.length
                        },
                        "[MEMPOOL-RESTORATION] Received mempool restoration data"
                    )

                    for (const userOpInfo of data.outstanding) {
                        await mempool.store.addOutstanding({
                            entryPoint,
                            userOpInfo,
                            isQueued: false
                        })
                    }

                    for (const userOpInfo of data.processing) {
                        await mempool.store.addOutstanding({
                            entryPoint,
                            userOpInfo,
                            isQueued: false
                        })
                    }

                    for (const userOpInfo of data.submitted) {
                        await mempool.store.addSubmitted({
                            entryPoint,
                            userOpInfo
                        })
                    }

                    for (const submittedBundle of data.pendingBundles) {
                        userOpMonitor.trackBundle(submittedBundle)
                        if (senderManager.lockWallet) {
                            senderManager.lockWallet(submittedBundle.executor)
                        }
                    }
                }
                return done()
            } catch (err) {
                done()
                logger.error(
                    { err },
                    "[MEMPOOL-RESTORATION] Error processing restoration message, continuing"
                )
            }
        })
    } catch (err) {
        logger.warn(
            { err },
            "[MEMPOOL-RESTORATION] Failed to start restoration listener, continuing without restoration"
        )
        if (restorationTimeout) {
            clearTimeout(restorationTimeout)
        }
    }
}
