import { Executor, ExecutorManager, type SenderManager } from "@alto/executor"
import { EventManager, type GasPriceManager } from "@alto/handlers"
import {
    type InterfaceReputationManager,
    Mempool,
    Monitor,
    NullReputationManager,
    ReputationManager
} from "@alto/mempool"
import { RpcHandler, SafeValidator, Server, UnsafeValidator } from "@alto/rpc"
import type { InterfaceValidator } from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Registry } from "prom-client"
import type { AltoConfig } from "../createConfig"
import { validateAndRefillWallets } from "../executor/senderManager/validateAndRefill"
import { flushOnStartUp } from "../executor/senderManager/flushOnStartUp"
import { createMempoolStore } from "../store/createMempoolStore"

const getReputationManager = (
    config: AltoConfig
): InterfaceReputationManager => {
    if (config.safeMode) {
        return new ReputationManager(config)
    }
    return new NullReputationManager()
}

const getValidator = ({
    config,
    senderManager,
    metrics,
    gasPriceManager
}: {
    config: AltoConfig
    senderManager: SenderManager
    metrics: Metrics
    gasPriceManager: GasPriceManager
}): InterfaceValidator => {
    if (config.safeMode) {
        return new SafeValidator({
            config,
            senderManager,
            metrics,
            gasPriceManager
        })
    }
    return new UnsafeValidator({
        config,
        metrics,
        gasPriceManager
    })
}

const getMonitor = ({ config }: { config: AltoConfig }): Monitor => {
    return new Monitor({ config })
}

const getMempool = ({
    config,
    monitor,
    reputationManager,
    validator,
    metrics,
    eventManager
}: {
    config: AltoConfig
    monitor: Monitor
    reputationManager: InterfaceReputationManager
    validator: InterfaceValidator
    metrics: Metrics
    eventManager: EventManager
}): Mempool => {
    return new Mempool({
        config,
        monitor,
        store: createMempoolStore({ config, metrics }),
        reputationManager,
        validator,
        eventManager
    })
}

const getEventManager = ({
    config,
    metrics
}: {
    config: AltoConfig
    metrics: Metrics
}) => {
    return new EventManager({ config, metrics })
}

const getExecutor = ({
    mempool,
    config,
    reputationManager,
    metrics,
    gasPriceManager,
    eventManager
}: {
    mempool: Mempool
    config: AltoConfig
    reputationManager: InterfaceReputationManager
    metrics: Metrics
    gasPriceManager: GasPriceManager
    eventManager: EventManager
}): Executor => {
    return new Executor({
        mempool,
        config,
        reputationManager,
        metrics,
        gasPriceManager,
        eventManager
    })
}

const getExecutorManager = ({
    config,
    executor,
    mempool,
    monitor,
    senderManager,
    reputationManager,
    metrics,
    gasPriceManager,
    eventManager
}: {
    config: AltoConfig
    executor: Executor
    mempool: Mempool
    monitor: Monitor
    reputationManager: InterfaceReputationManager
    senderManager: SenderManager
    metrics: Metrics
    gasPriceManager: GasPriceManager
    eventManager: EventManager
}) => {
    return new ExecutorManager({
        config,
        executor,
        mempool,
        monitor,
        senderManager,
        reputationManager,
        metrics,
        gasPriceManager,
        eventManager
    })
}

const getRpcHandler = ({
    config,
    validator,
    mempool,
    executor,
    monitor,
    executorManager,
    reputationManager,
    metrics,
    gasPriceManager,
    eventManager
}: {
    config: AltoConfig
    validator: InterfaceValidator
    mempool: Mempool
    executor: Executor
    monitor: Monitor
    executorManager: ExecutorManager
    reputationManager: InterfaceReputationManager
    metrics: Metrics
    eventManager: EventManager
    gasPriceManager: GasPriceManager
}) => {
    return new RpcHandler({
        config,
        validator,
        mempool,
        executor,
        monitor,
        executorManager,
        reputationManager,
        metrics,
        eventManager,
        gasPriceManager
    })
}

const getServer = ({
    config,
    rpcEndpoint,
    registry,
    metrics
}: {
    config: AltoConfig
    rpcEndpoint: RpcHandler
    registry: Registry
    metrics: Metrics
}) => {
    return new Server({
        config,
        rpcEndpoint,
        registry,
        metrics
    })
}

export const setupServer = async ({
    config,
    registry,
    metrics,
    senderManager,
    gasPriceManager
}: {
    config: AltoConfig
    registry: Registry
    metrics: Metrics
    senderManager: SenderManager
    gasPriceManager: GasPriceManager
}) => {
    const validator = getValidator({
        config,
        senderManager,
        metrics,
        gasPriceManager
    })
    const reputationManager = getReputationManager(config)

    const eventManager = getEventManager({
        config,
        metrics
    })

    // When running with horizontal scaling enabled, only one instance should have this flag enabled,
    // otherwise all instances will try to refill wallets.
    if (config.refillingWallets) {
        const rootLogger = config.getLogger(
            { module: "root" },
            { level: config.logLevel }
        )
        try {
            await validateAndRefillWallets({
                metrics,
                config,
                senderManager,
                gasPriceManager
            })
        } catch (error) {
            rootLogger.error(
                { error: error instanceof Error ? error.stack : error },
                "Error during initial wallet validation and refill"
            )
        }

        setInterval(async () => {
            try {
                await validateAndRefillWallets({
                    metrics,
                    config,
                    senderManager,
                    gasPriceManager
                })
            } catch (error) {
                rootLogger.error(
                    { error: error instanceof Error ? error.stack : error },
                    "Error during scheduled wallet validation and refill"
                )
            }
        }, config.executorRefillInterval * 1000)
    }

    const monitor = getMonitor({ config })
    const mempool = getMempool({
        config,
        monitor,
        reputationManager,
        validator,
        metrics,
        eventManager
    })

    const executor = getExecutor({
        mempool,
        config,
        reputationManager,
        metrics,
        gasPriceManager,
        eventManager
    })

    const executorManager = getExecutorManager({
        config,
        executor,
        mempool,
        monitor,
        senderManager,
        reputationManager,
        metrics,
        gasPriceManager,
        eventManager
    })

    const rpcEndpoint = getRpcHandler({
        config,
        validator,
        mempool,
        executor,
        monitor,
        executorManager,
        reputationManager,
        metrics,
        gasPriceManager,
        eventManager
    })

    if (config.flushStuckTransactionsDuringStartup) {
        flushOnStartUp({
            senderManager,
            gasPriceManager,
            config
        })
    }

    const rootLogger = config.getLogger(
        { module: "root" },
        { level: config.logLevel }
    )

    const walletsLength = senderManager.getAllWallets().length
    rootLogger.info(`Initialized ${walletsLength} executor wallets`)

    const server = getServer({
        config,
        rpcEndpoint,
        registry,
        metrics
    })

    server.start()

    const gracefulShutdown = async (signal: string) => {
        rootLogger.info(`${signal} received, shutting down`)

        await server.stop()
        rootLogger.info("server stopped")

        for (const entryPoint of config.entrypoints) {
            const outstanding = [...(await mempool.dumpOutstanding(entryPoint))]
            const submitted = [...(await mempool.dumpSubmittedOps(entryPoint))]
            const processing = [...(await mempool.dumpProcessing(entryPoint))]
            await executorManager.dropUserOps(entryPoint, [
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
            ])
            rootLogger.info(
                {
                    outstanding: outstanding.length,
                    submitted: submitted.length,
                    processing: processing.length
                },
                "dumping mempool before shutdown"
            )
        }

        // mark all executors as processed
        for (const account of senderManager.getActiveWallets()) {
            await senderManager.markWalletProcessed(account)
        }

        process.exit(0)
    }

    const signals = ["SIGINT", "SIGTERM"]

    // Handle regular termination signals
    signals.forEach((signal) => {
        process.on(signal, async () => {
            try {
                await gracefulShutdown(signal)
            } catch (error) {
                rootLogger.error(
                    { error: error instanceof Error ? error.stack : error },
                    `Error during ${signal} shutdown`
                )
                process.exit(1)
            }
        })
    })

    // Handle unhandled rejections with the actual rejection reason
    process.on("unhandledRejection", async (err) => {
        rootLogger.error(
            {
                err
            },
            `Unhandled Promise Rejection`
        )
        try {
            await gracefulShutdown("unhandledRejection")
        } catch (err) {
            rootLogger.error(
                { err },
                `Error during unhandledRejection shutdown`
            )
            process.exit(1)
        }
    })

    // Handle uncaught exceptions with the actual error
    process.on("uncaughtException", async (err) => {
        rootLogger.error({ err }, `Uncaught Exception`)
        try {
            await gracefulShutdown("uncaughtException")
        } catch (err) {
            rootLogger.error(
                {
                    err
                },
                `Error during uncaughtException shutdown`
            )
            process.exit(1)
        }
    })
}
