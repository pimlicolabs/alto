import type { SenderManager } from "@alto/executor"
import { Executor, ExecutorManager } from "@alto/executor"
import { EventManager, type GasPriceManager } from "@alto/handlers"
import {
    type InterfaceReputationManager,
    MemoryMempool,
    Monitor,
    NullReputationManager,
    ReputationManager
} from "@alto/mempool"
import {
    NonceQueuer,
    RpcHandler,
    SafeValidator,
    Server,
    UnsafeValidator
} from "@alto/rpc"
import type { InterfaceValidator } from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Registry } from "prom-client"
import type { AltoConfig } from "../createConfig"

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
}): MemoryMempool => {
    return new MemoryMempool({
        config,
        monitor,
        reputationManager,
        validator,
        metrics,
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
    senderManager,
    reputationManager,
    metrics,
    gasPriceManager,
    eventManager
}: {
    mempool: MemoryMempool
    config: AltoConfig
    senderManager: SenderManager
    reputationManager: InterfaceReputationManager
    metrics: Metrics
    gasPriceManager: GasPriceManager
    eventManager: EventManager
}): Executor => {
    return new Executor({
        mempool,
        config,
        senderManager,
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
    reputationManager,
    metrics,
    gasPriceManager,
    eventManager
}: {
    config: AltoConfig
    executor: Executor
    mempool: MemoryMempool
    monitor: Monitor
    reputationManager: InterfaceReputationManager
    metrics: Metrics
    gasPriceManager: GasPriceManager
    eventManager: EventManager
}) => {
    return new ExecutorManager({
        config,
        executor,
        mempool,
        monitor,
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
    mempool: MemoryMempool
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
    mempool: MemoryMempool
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
        gasPriceManager,
        eventManager
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
        await senderManager.validateAndRefillWallets()

        setInterval(async () => {
            await senderManager.validateAndRefillWallets()
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
        senderManager,
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
        executor.flushStuckTransactions()
    }

    const rootLogger = config.getLogger(
        { module: "root" },
        { level: config.logLevel }
    )

    rootLogger.info(
        `Initialized ${senderManager.wallets.length} executor wallets`
    )

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

        const outstanding = mempool.dumpOutstanding().length
        const submitted = mempool.dumpSubmittedOps().length
        const processing = mempool.dumpProcessing().length
        rootLogger.info(
            { outstanding, submitted, processing },
            "dumping mempool before shutdown"
        )

        process.exit(0)
    }

    process.on("SIGINT", gracefulShutdown)
    process.on("SIGTERM", gracefulShutdown)
}
