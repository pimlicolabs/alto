import type { BundleManager, SenderManager } from "@alto/executor"
import type { Mempool, StatusManager } from "@alto/mempool"
import type {
    SerializableSubmittedBundleInfo,
    SubmittedBundleInfo
} from "@alto/types"
import {
    recoverableJsonParseWithBigint,
    recoverableJsonStringifyWithBigint
} from "@alto/utils"
import Queue from "bull"
import Redis from "ioredis"
import type { Logger } from "pino"
import type { AltoConfig } from "../createConfig"

const getQueueName = (chainId: number) => `alto:mempool:restoration:${chainId}`

// Transform SubmittedBundleInfo to a serializable format
function serializePendingBundle(
    bundle: SubmittedBundleInfo
): SerializableSubmittedBundleInfo {
    const executorAddress = bundle.executor.address
    return {
        executorAddress,
        uid: bundle.uid,
        transactionHash: bundle.transactionHash,
        previousTransactionHashes: bundle.previousTransactionHashes,
        transactionRequest: bundle.transactionRequest,
        bundle: bundle.bundle,
        lastReplaced: bundle.lastReplaced
    }
}

// Reconstruct SubmittedBundleInfo from serialized format.
// Note: converts executorAddress to Account object from senderManager.
function deserializePendingBundle(
    serializedBundle: SerializableSubmittedBundleInfo,
    senderManager: SenderManager,
    logger: Logger
): SubmittedBundleInfo | null {
    const allWallets = senderManager.getAllWallets()
    const executor = allWallets.find(
        (wallet) => wallet.address === serializedBundle.executorAddress
    )

    if (!executor) {
        logger.warn(
            { executorAddress: serializedBundle.executorAddress },
            "[MEMPOOL-RESTORATION] Executor wallet not found in pool, skipping bundle"
        )
        return null
    }

    return {
        executor,
        uid: serializedBundle.uid,
        transactionHash: serializedBundle.transactionHash,
        previousTransactionHashes: serializedBundle.previousTransactionHashes,
        transactionRequest: serializedBundle.transactionRequest,
        bundle: serializedBundle.bundle,
        lastReplaced: serializedBundle.lastReplaced
    }
}

async function dropAllOperationsOnShutdown({
    config,
    mempool,
    logger
}: { config: AltoConfig; mempool: Mempool; logger: Logger }) {
    await Promise.all(
        config.entrypoints.map(async (entryPoint) => {
            try {
                const outstanding = await mempool.dumpOutstanding(entryPoint)

                const rejectedUserOps = outstanding.map((userOp) => ({
                    ...userOp,
                    reason: "shutdown"
                }))

                if (rejectedUserOps.length > 0) {
                    await mempool.dropUserOps(entryPoint, rejectedUserOps)
                }

                logger.info(
                    {
                        outstanding: outstanding.length
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

export async function persistShutdownState({
    mempool,
    bundleManager,
    statusManager,
    config,
    logger
}: {
    mempool: Mempool
    bundleManager: BundleManager
    statusManager: StatusManager
    config: AltoConfig
    logger: Logger
}) {
    // When horizontal scaling is enabled, state is already saved between shutdowns.
    if (config.enableHorizontalScaling) {
        return
    }

    if (!config.redisEndpoint) {
        // No queue configured, drop all operations.
        return dropAllOperationsOnShutdown({ mempool, logger, config })
    }

    const redisEndpoint = config.redisEndpoint

    try {
        const redis = new Redis(redisEndpoint)
        const queueName = getQueueName(config.chainId)
        const restorationQueue = new Queue(queueName, {
            createClient: () => {
                return redis
            },
            defaultJobOptions: {
                removeOnComplete: true,
                removeOnFail: true
            }
        })

        logger.info(
            {
                queueName,
                chainId: config.publicClient.chain.id
            },
            "[MEMPOOL-RESTORATION] Publishing to restoration queue during shutdown"
        )

        // Collect all state
        const [pendingBundles, userOpStatus] = [
            bundleManager.getPendingBundles(),
            statusManager.dumpAll()
        ]

        const entrypointData = await Promise.all(
            config.entrypoints.map(async (entryPoint) => {
                try {
                    const outstanding =
                        await mempool.dumpOutstanding(entryPoint)
                    return { entryPoint, outstanding }
                } catch (err) {
                    logger.error(
                        { err, entryPoint },
                        "[MEMPOOL-RESTORATION] Failed to dump outstanding for entrypoint, continuing"
                    )
                    return { entryPoint, outstanding: [] }
                }
            })
        )

        const totalOutstanding = entrypointData.reduce(
            (sum, { outstanding }) => sum + outstanding.length,
            0
        )

        if (
            totalOutstanding > 0 ||
            pendingBundles.length > 0 ||
            userOpStatus.length > 0
        ) {
            // Transform pendingBundles to serialized format.
            const serializedPendingBundles = pendingBundles.map(
                serializePendingBundle
            )

            await restorationQueue.add({
                type: "MEMPOOL_DATA",
                chainId: config.publicClient.chain.id,
                data: recoverableJsonStringifyWithBigint({
                    entrypointData,
                    pendingBundles: serializedPendingBundles,
                    userOpStatus
                }),
                timestamp: Date.now()
            })

            logger.info(
                {
                    entrypoints: entrypointData.length,
                    totalOutstanding,
                    pendingBundles: pendingBundles.length,
                    userOpStatus: userOpStatus.length
                },
                "[MEMPOOL-RESTORATION] Published mempool data to restoration queue"
            )
        } else {
            logger.info(
                "[MEMPOOL-RESTORATION] No state to persist, skipping queue publication"
            )
        }

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

export async function restoreShutdownState({
    mempool,
    bundleManager,
    statusManager,
    config,
    logger,
    senderManager
}: {
    mempool: Mempool
    bundleManager: BundleManager
    statusManager: StatusManager
    config: AltoConfig
    logger: Logger
    senderManager: SenderManager
}) {
    const redisEndpoint = config.redisEndpoint
    if (!redisEndpoint) {
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
                            client = new Redis(redisEndpoint, {
                                ...redisOpts,
                                enableReadyCheck: false,
                                maxRetriesPerRequest: null
                            })
                        }
                        return client
                    }
                    case "subscriber": {
                        if (!subscriber) {
                            subscriber = new Redis(redisEndpoint, {
                                ...redisOpts,
                                enableReadyCheck: false,
                                maxRetriesPerRequest: null
                            })
                        }
                        return subscriber
                    }
                    case "bclient":
                        return new Redis(redisEndpoint, {
                            ...redisOpts,
                            enableReadyCheck: false,
                            maxRetriesPerRequest: null
                        })
                    default:
                        throw new Error(`Unexpected connection type: ${type}`)
                }
            },
            defaultJobOptions: {
                removeOnComplete: true,
                removeOnFail: true
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

                if (message.type === "MEMPOOL_DATA") {
                    const data = recoverableJsonParseWithBigint(message.data)

                    const totalOutstanding = data.entrypointData.reduce(
                        (sum: number, { outstanding }: any) =>
                            sum + outstanding.length,
                        0
                    )

                    logger.info(
                        {
                            entrypoints: data.entrypointData.length,
                            totalOutstanding,
                            pendingBundles: data.pendingBundles.length,
                            userOpStatus: data.userOpStatus?.length || 0
                        },
                        "[MEMPOOL-RESTORATION] Received mempool restoration data"
                    )

                    // Restore per-entrypoint outstanding operations.
                    for (const {
                        entryPoint,
                        outstanding
                    } of data.entrypointData) {
                        if (outstanding.length > 0) {
                            await mempool.store.addOutstanding({
                                entryPoint,
                                userOpInfos: outstanding
                            })
                        }
                    }

                    // Restore global pending bundles
                    for (const serializedBundle of data.pendingBundles) {
                        const submittedBundle = deserializePendingBundle(
                            serializedBundle,
                            senderManager,
                            logger
                        )

                        if (!submittedBundle) {
                            // Wallet not found, already logged in deserializePendingBundle
                            continue
                        }

                        bundleManager.trackBundle(submittedBundle)
                        if (senderManager.lockWallet) {
                            senderManager.lockWallet(submittedBundle.executor)
                        }
                    }

                    // Restore global user op status.
                    if (data.userOpStatus && data.userOpStatus.length > 0) {
                        statusManager.restore(data.userOpStatus)
                    }

                    // Close after processing.
                    logger.info(
                        "[MEMPOOL-RESTORATION] Restoration complete, stopping listener"
                    )
                    if (restorationTimeout) {
                        clearTimeout(restorationTimeout)
                    }
                    await restorationQueue.close()
                    await client.quit()
                    await subscriber.quit()
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
