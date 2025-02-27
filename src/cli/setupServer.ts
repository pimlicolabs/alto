import { Executor, ExecutorManager, type SenderManager } from "@alto/executor"
import { EventManager, type GasPriceManager } from "@alto/handlers"
import {
    type InterfaceReputationManager,
    Mempool,
    Monitor,
    NullReputationManager,
    ReputationManager,
    NonceQueuer
} from "@alto/mempool"
import { RpcHandler, SafeValidator, Server, UnsafeValidator } from "@alto/rpc"
import type { InterfaceValidator } from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Registry } from "prom-client"
import type { AltoConfig } from "../createConfig"
import { MempoolStore, createMemoryStore, createRedisStore } from "@alto/store"
import { validateAndRefillWallets } from "../executor/senderManager/validateAndRefill"
import { flushOnStartUp } from "../executor/senderManager/flushOnStartUp"

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

const getMonitor = (): Monitor => {
    return new Monitor()
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
    let store: MempoolStore

    if (config.redisMempoolUrl) {
        store = createRedisStore({
            config,
            metrics
        })
    } else {
        store = createMemoryStore({
            config,
            metrics
        })
    }

    return new Mempool({
        config,
        monitor,
        store,
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

const getNonceQueuer = ({
    config,
    mempool,
    eventManager
}: {
    config: AltoConfig
    mempool: Mempool
    eventManager: EventManager
}) => {
    return new NonceQueuer({
        config,
        mempool,
        eventManager
    })
}

const getRpcHandler = ({
    config,
    validator,
    mempool,
    executor,
    monitor,
    nonceQueuer,
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
    nonceQueuer: NonceQueuer
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
        nonceQueuer,
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

    if (config.refillingWallets) {
        await validateAndRefillWallets({
            metrics,
            config,
            senderManager,
            gasPriceManager
        })

        setInterval(async () => {
            await validateAndRefillWallets({
                metrics,
                config,
                senderManager,
                gasPriceManager
            })
        }, config.executorRefillInterval * 1000)
    }

    const monitor = getMonitor()
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

    const nonceQueuer = getNonceQueuer({
        config,
        mempool,
        eventManager
    })

    const rpcEndpoint = getRpcHandler({
        config,
        validator,
        mempool,
        executor,
        monitor,
        nonceQueuer,
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

        const outstanding = (await mempool.dumpOutstanding()).length
        const submitted = (await mempool.dumpSubmittedOps()).length
        const processing = (await mempool.dumpProcessing()).length
        rootLogger.info(
            { outstanding, submitted, processing },
            "dumping mempool before shutdown"
        )

        // mark all executors as processed
        for (const account of senderManager.getActiveWallets()) {
            senderManager.markWalletProcessed(account)
        }

        process.exit(0)
    }

    const signals = [
        "SIGINT",
        "SIGTERM",
        "unhandledRejection",
        "uncaughtException"
    ]
    signals.forEach((signal) => {
        process.on(signal, async () => await gracefulShutdown(signal))
    })
}
