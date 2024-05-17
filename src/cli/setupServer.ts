import type { SenderManager } from "@alto/executor"
import { Executor, ExecutorManager } from "@alto/executor"
import {
    MemoryMempool,
    Monitor,
    NullReputationManager,
    ReputationManager,
    type InterfaceReputationManager
} from "@alto/mempool"
import {
    NonceQueuer,
    RpcHandler,
    SafeValidator,
    Server,
    UnsafeValidator
} from "@alto/rpc"
import type { InterfaceValidator } from "@alto/types"
import type { GasPriceManager, Logger, Metrics } from "@alto/utils"
import { CompressionHandler } from "@alto/utils"
import type { Registry } from "prom-client"
import type { Chain, PublicClient, Transport, WalletClient } from "viem"
import type { IBundleCompressionArgs, IOptions } from "./config"

const getReputationManager = ({
    client,
    parsedArgs,
    logger
}: {
    client: PublicClient<Transport, Chain>
    parsedArgs: IOptions
    logger: Logger
}): InterfaceReputationManager => {
    if (parsedArgs["safe-mode"]) {
        return new ReputationManager(
            client,
            parsedArgs.entrypoints,
            BigInt(parsedArgs["min-entity-stake"]),
            BigInt(parsedArgs["min-entity-unstake-delay"]),
            logger.child(
                { module: "reputation_manager" },
                {
                    level:
                        parsedArgs["reputation-manager-log-level"] ||
                        parsedArgs["log-level"]
                }
            )
        )
    }
    return new NullReputationManager()
}

const getValidator = ({
    client,
    parsedArgs,
    logger,
    senderManager,
    metrics,
    gasPriceManager
}: {
    client: PublicClient<Transport, Chain>
    parsedArgs: IOptions
    logger: Logger
    senderManager: SenderManager
    metrics: Metrics
    gasPriceManager: GasPriceManager
}): InterfaceValidator => {
    if (parsedArgs["safe-mode"]) {
        return new SafeValidator(
            client,
            senderManager,
            logger.child(
                { module: "rpc" },
                {
                    level:
                        parsedArgs["rpc-log-level"] || parsedArgs["log-level"]
                }
            ),
            metrics,
            gasPriceManager,
            parsedArgs["chain-type"],
            parsedArgs["entrypoint-simulation-contract"],
            parsedArgs.tenderly,
            parsedArgs["balance-override"]
        )
    }
    return new UnsafeValidator(
        client,
        logger.child(
            { module: "rpc" },
            { level: parsedArgs["rpc-log-level"] || parsedArgs["log-level"] }
        ),
        metrics,
        gasPriceManager,
        parsedArgs["chain-type"],
        parsedArgs["entrypoint-simulation-contract"],
        parsedArgs.tenderly,
        parsedArgs["balance-override"],
        parsedArgs["expiration-check"]
    )
}

const getMonitor = (): Monitor => {
    return new Monitor()
}

const getMempool = ({
    monitor,
    reputationManager,
    validator,
    client,
    parsedArgs,
    logger,
    metrics
}: {
    monitor: Monitor
    reputationManager: InterfaceReputationManager
    validator: InterfaceValidator
    client: PublicClient<Transport, Chain>
    parsedArgs: IOptions
    logger: Logger
    metrics: Metrics
}): MemoryMempool => {
    return new MemoryMempool(
        monitor,
        reputationManager,
        validator,
        client,
        parsedArgs["safe-mode"],
        logger.child(
            { module: "mempool" },
            {
                level:
                    parsedArgs["mempool-log-level"] || parsedArgs["log-level"]
            }
        ),
        metrics,
        parsedArgs["mempool-max-parallel-ops"],
        parsedArgs["mempool-max-queued-ops"],
        parsedArgs["enforce-unique-senders-per-bundle"]
    )
}

const getCompressionHandler = async ({
    client,
    parsedArgs
}: {
    client: PublicClient<Transport, Chain>
    parsedArgs: IBundleCompressionArgs
}): Promise<CompressionHandler | null> => {
    let compressionHandler: CompressionHandler | null = null
    if (
        parsedArgs["bundle-bulker-address"] !== undefined &&
        parsedArgs["per-op-inflator-address"] !== undefined
    ) {
        compressionHandler = await CompressionHandler.createAsync(
            parsedArgs["bundle-bulker-address"],
            parsedArgs["per-op-inflator-address"],
            client
        )
    }
    return compressionHandler
}

const getExecutor = ({
    client,
    walletClient,
    senderManager,
    reputationManager,
    parsedArgs,
    logger,
    metrics,
    compressionHandler,
    gasPriceManager
}: {
    client: PublicClient<Transport, Chain>
    walletClient: WalletClient<Transport, Chain>
    senderManager: SenderManager
    reputationManager: InterfaceReputationManager
    parsedArgs: IOptions
    logger: Logger
    metrics: Metrics
    compressionHandler: CompressionHandler | null
    gasPriceManager: GasPriceManager
}): Executor => {
    return new Executor(
        client,
        walletClient,
        senderManager,
        reputationManager,
        parsedArgs.entrypoints,
        logger.child(
            { module: "executor" },
            {
                level:
                    parsedArgs["executor-log-level"] || parsedArgs["log-level"]
            }
        ),
        metrics,
        compressionHandler,
        gasPriceManager,
        !parsedArgs.tenderly,
        parsedArgs["legacy-transactions"],
        parsedArgs["fixed-gas-limit-for-estimation"],
        parsedArgs["local-gas-limit-calculation"]
    )
}

const getExecutorManager = ({
    executor,
    mempool,
    monitor,
    reputationManager,
    client,
    parsedArgs,
    logger,
    metrics,
    gasPriceManager
}: {
    executor: Executor
    mempool: MemoryMempool
    monitor: Monitor
    reputationManager: InterfaceReputationManager
    client: PublicClient<Transport, Chain>
    parsedArgs: IOptions
    logger: Logger
    metrics: Metrics
    gasPriceManager: GasPriceManager
}) => {
    return new ExecutorManager(
        executor,
        parsedArgs.entrypoints,
        mempool,
        monitor,
        reputationManager,
        client,
        parsedArgs["polling-interval"],
        logger.child(
            { module: "executor" },
            {
                level:
                    parsedArgs["executor-log-level"] || parsedArgs["log-level"]
            }
        ),
        metrics,
        parsedArgs["bundle-mode"],
        parsedArgs["max-bundle-wait"],
        parsedArgs["max-gas-per-bundle"],
        gasPriceManager
    )
}

const getNonceQueuer = ({
    mempool,
    client,
    parsedArgs,
    logger
}: {
    mempool: MemoryMempool
    client: PublicClient<Transport, Chain>
    parsedArgs: IOptions
    logger: Logger
}) => {
    return new NonceQueuer(
        mempool,
        client,
        logger.child(
            { module: "nonce_queuer" },
            {
                level:
                    parsedArgs["nonce-queuer-log-level"] ||
                    parsedArgs["log-level"]
            }
        )
    )
}

const getRpcHandler = ({
    client,
    validator,
    mempool,
    executor,
    monitor,
    nonceQueuer,
    executorManager,
    reputationManager,
    parsedArgs,
    logger,
    metrics,
    compressionHandler,
    gasPriceManager
}: {
    client: PublicClient<Transport, Chain>
    validator: InterfaceValidator
    mempool: MemoryMempool
    executor: Executor
    monitor: Monitor
    nonceQueuer: NonceQueuer
    executorManager: ExecutorManager
    reputationManager: InterfaceReputationManager
    parsedArgs: IOptions
    logger: Logger
    metrics: Metrics
    compressionHandler: CompressionHandler | null
    gasPriceManager: GasPriceManager
}) => {
    return new RpcHandler(
        parsedArgs.entrypoints,
        client,
        validator,
        mempool,
        executor,
        monitor,
        nonceQueuer,
        executorManager,
        reputationManager,
        parsedArgs.tenderly ?? false,
        parsedArgs["max-block-range"],
        logger.child(
            { module: "rpc" },
            { level: parsedArgs["rpc-log-level"] || parsedArgs["log-level"] }
        ),
        metrics,
        parsedArgs["enable-debug-endpoints"],
        compressionHandler,
        parsedArgs["legacy-transactions"],
        gasPriceManager,
        parsedArgs["gas-price-multipliers"],
        parsedArgs["chain-type"],
        parsedArgs["dangerous-skip-user-operation-validation"]
    )
}

const getServer = ({
    rpcEndpoint,
    parsedArgs,
    logger,
    registry,
    metrics
}: {
    rpcEndpoint: RpcHandler
    parsedArgs: IOptions
    logger: Logger
    registry: Registry
    metrics: Metrics
}) => {
    return new Server(
        rpcEndpoint,
        parsedArgs["api-version"],
        parsedArgs["default-api-version"],
        parsedArgs.port,
        parsedArgs.timeout,
        parsedArgs["websocket-max-payload-size"],
        parsedArgs.websocket,
        logger.child(
            { module: "rpc" },
            { level: parsedArgs["rpc-log-level"] || parsedArgs["log-level"] }
        ),
        registry,
        metrics
    )
}

export const setupServer = async ({
    client,
    walletClient,
    parsedArgs,
    logger,
    rootLogger,
    registry,
    metrics,
    senderManager,
    gasPriceManager
}: {
    client: PublicClient<Transport, Chain>
    walletClient: WalletClient<Transport, Chain>
    parsedArgs: IOptions
    logger: Logger
    rootLogger: Logger
    registry: Registry
    metrics: Metrics
    senderManager: SenderManager
    gasPriceManager: GasPriceManager
}) => {
    const validator = getValidator({
        client,
        logger,
        parsedArgs,
        senderManager,
        metrics,
        gasPriceManager
    })
    const reputationManager = getReputationManager({
        client,
        parsedArgs,
        logger
    })

    await senderManager.validateAndRefillWallets(
        client,
        walletClient,
        parsedArgs["min-executor-balance"]
    )

    setInterval(async () => {
        await senderManager.validateAndRefillWallets(
            client,
            walletClient,
            parsedArgs["min-executor-balance"]
        )
    }, parsedArgs["executor-refill-interval"] * 1000)

    const monitor = getMonitor()
    const mempool = getMempool({
        monitor,
        reputationManager,
        validator,
        client,
        parsedArgs,
        logger,
        metrics
    })

    const compressionHandler = await getCompressionHandler({
        client,
        parsedArgs
    })

    const executor = getExecutor({
        client,
        walletClient,
        senderManager,
        reputationManager,
        parsedArgs,
        logger,
        metrics,
        compressionHandler,
        gasPriceManager
    })

    const executorManager = getExecutorManager({
        executor,
        mempool,
        monitor,
        reputationManager,
        client,
        parsedArgs,
        logger,
        metrics,
        gasPriceManager
    })

    const nonceQueuer = getNonceQueuer({ mempool, client, parsedArgs, logger })

    const rpcEndpoint = getRpcHandler({
        client,
        validator,
        mempool,
        executor,
        monitor,
        nonceQueuer,
        executorManager,
        reputationManager,
        parsedArgs,
        logger,
        metrics,
        compressionHandler,
        gasPriceManager
    })

    if (parsedArgs["flush-stuck-transactions-during-startup"]) {
        executor.flushStuckTransactions()
    }

    rootLogger.info(
        `Initialized ${senderManager.wallets.length} executor wallets`
    )

    const server = getServer({
        rpcEndpoint,
        parsedArgs,
        logger,
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
