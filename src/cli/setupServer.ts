import { Executor, ExecutorManager, type SenderManager } from "@alto/executor"
import { EventManager, type GasPriceManager } from "@alto/handlers"
import {
    type InterfaceReputationManager,
    Mempool,
    NullReputationManager,
    ReputationManager,
    StatusManager
} from "@alto/mempool"
import { RpcHandler, SafeValidator, Server, UnsafeValidator } from "@alto/rpc"
import { createMempoolStore } from "@alto/store"
import type { InterfaceValidator } from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Registry } from "prom-client"
import type { AltoConfig } from "../createConfig"
import { BundleManager } from "../executor/bundleManager"
import { flushOnStartUp } from "../executor/senderManager/flushOnStartUp"
import { validateAndRefillWallets } from "../executor/senderManager/validateAndRefill"
import { persistShutdownState, restoreShutdownState } from "./shutDown"

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

const getStatusManager = ({
    config
}: { config: AltoConfig }): StatusManager => {
    return new StatusManager({ config })
}

const getMempool = ({
    config,
    statusManager,
    reputationManager,
    validator,
    metrics,
    eventManager
}: {
    config: AltoConfig
    statusManager: StatusManager
    reputationManager: InterfaceReputationManager
    validator: InterfaceValidator
    metrics: Metrics
    eventManager: EventManager
}): Mempool => {
    return new Mempool({
        config,
        statusManager,
        metrics,
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
    config,
    eventManager
}: {
    config: AltoConfig
    eventManager: EventManager
}): Executor => {
    return new Executor({
        config,
        eventManager
    })
}

const getExecutorManager = ({
    config,
    executor,
    mempool,
    senderManager,
    metrics,
    gasPriceManager,
    bundleManager
}: {
    config: AltoConfig
    executor: Executor
    mempool: Mempool
    senderManager: SenderManager
    metrics: Metrics
    gasPriceManager: GasPriceManager
    bundleManager: BundleManager
}) => {
    return new ExecutorManager({
        config,
        executor,
        bundleManager,
        mempool,
        senderManager,
        metrics,
        gasPriceManager
    })
}

const getRpcHandler = ({
    config,
    validator,
    mempool,
    executor,
    statusManager,
    executorManager,
    reputationManager,
    bundleManager,
    metrics,
    gasPriceManager,
    eventManager
}: {
    config: AltoConfig
    validator: InterfaceValidator
    mempool: Mempool
    executor: Executor
    statusManager: StatusManager
    executorManager: ExecutorManager
    reputationManager: InterfaceReputationManager
    bundleManager: BundleManager
    metrics: Metrics
    eventManager: EventManager
    gasPriceManager: GasPriceManager
}) => {
    return new RpcHandler({
        config,
        validator,
        mempool,
        executor,
        statusManager,
        executorManager,
        reputationManager,
        bundleManager,
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

    const statusManager = getStatusManager({ config })
    const mempool = getMempool({
        config,
        statusManager,
        reputationManager,
        validator,
        metrics,
        eventManager
    })

    const executor = getExecutor({
        config,
        eventManager
    })

    const bundleManager = new BundleManager({
        config,
        mempool,
        statusManager,
        metrics,
        reputationManager,
        gasPriceManager,
        eventManager,
        senderManager
    })

    const executorManager = getExecutorManager({
        bundleManager,
        config,
        executor,
        mempool,
        senderManager,
        metrics,
        gasPriceManager
    })

    const rpcEndpoint = getRpcHandler({
        config,
        validator,
        mempool,
        executor,
        statusManager,
        executorManager,
        reputationManager,
        bundleManager,
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

    const shutdownLogger = rootLogger.child(
        { module: "shutdown" },
        {
            level: config.logLevel
        }
    )

    // Ignore when horizontal scaling is enabled, because state is already saved between shutdowns.
    if (!config.enableHorizontalScaling) {
        restoreShutdownState({
            mempool,
            bundleManager,
            statusManager,
            config,
            logger: shutdownLogger,
            senderManager
        })
    }

    server.start()
    executorManager.start()

    const gracefulShutdown = async (signal: string) => {
        rootLogger.info(`${signal} received, shutting down`)

        await server.stop()
        rootLogger.info("server stopped")

        await persistShutdownState({
            mempool,
            config,
            bundleManager,
            statusManager,
            logger: shutdownLogger
        })

        // mark all executors as processed
        for (const account of senderManager.getActiveWallets()) {
            await senderManager.markWalletProcessed(account)
        }

        process.exit(0)
    }

    const signals = ["SIGINT", "SIGTERM"]

    // Handle regular termination signals
    for (const signal of signals) {
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
    }

    // Handle unhandled rejections with the actual rejection reason
    process.on("unhandledRejection", async (err) => {
        rootLogger.error(
            {
                err
            },
            "Unhandled Promise Rejection"
        )
        try {
            await gracefulShutdown("unhandledRejection")
        } catch (err) {
            rootLogger.error(
                { err },
                "Error during unhandledRejection shutdown"
            )
            process.exit(1)
        }
    })

    // Handle uncaught exceptions with the actual error
    process.on("uncaughtException", async (err) => {
        rootLogger.error({ err }, "Uncaught Exception")
        try {
            await gracefulShutdown("uncaughtException")
        } catch (err) {
            rootLogger.error(
                {
                    err
                },
                "Error during uncaughtException shutdown"
            )
            process.exit(1)
        }
    })
}
