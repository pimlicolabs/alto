import type { GasPriceManager, Logger } from "@alto/utils"
import type { IBundlerArgs } from "./config"
import type { Metrics } from "@alto/utils"
import {
    NullReputationManager,
    ReputationManager,
    Monitor,
    MemoryMempool,
    type InterfaceReputationManager
} from "@alto/mempool"
import type { Chain, PublicClient, Transport, WalletClient } from "viem"
import {
    NonceQueuer,
    RpcHandler,
    SafeValidator,
    Server,
    UnsafeValidator
} from "@alto/rpc"
import type { InterfaceValidator } from "@alto/types"
import { CompressionHandler } from "@alto/utils"
import { Executor, ExecutorManager } from "@alto/executor"
import type { Registry } from "prom-client"
import type { SenderManager } from "@alto/executor"

const getReputationManager = ({
    client,
    parsedArgs,
    logger
}: {
    client: PublicClient<Transport, Chain>
    parsedArgs: IBundlerArgs
    logger: Logger
}): InterfaceReputationManager => {
    if (parsedArgs.safeMode) {
        return new ReputationManager(
            client,
            parsedArgs.entryPoints,
            BigInt(parsedArgs.minStake),
            BigInt(parsedArgs.minUnstakeDelay),
            logger.child(
                { module: "reputation_manager" },
                {
                    level:
                        parsedArgs.reputationManagerLogLevel ||
                        parsedArgs.logLevel
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
    parsedArgs: IBundlerArgs
    logger: Logger
    senderManager: SenderManager
    metrics: Metrics
    gasPriceManager: GasPriceManager
}): InterfaceValidator => {
    if (parsedArgs.safeMode) {
        return new SafeValidator(
            client,
            senderManager,
            logger.child(
                { module: "rpc" },
                { level: parsedArgs.rpcLogLevel || parsedArgs.logLevel }
            ),
            metrics,
            parsedArgs.utilityPrivateKey,
            parsedArgs.apiVersion,
            gasPriceManager,
            parsedArgs.pimlicoSimulationsAddress,
            parsedArgs.tenderlyEnabled,
            parsedArgs.balanceOverrideEnabled
        )
    }
    return new UnsafeValidator(
        client,
        logger.child(
            { module: "rpc" },
            { level: parsedArgs.rpcLogLevel || parsedArgs.logLevel }
        ),
        metrics,
        parsedArgs.utilityPrivateKey,
        parsedArgs.apiVersion,
        gasPriceManager,
        parsedArgs.pimlicoSimulationsAddress,
        parsedArgs.tenderlyEnabled,
        parsedArgs.balanceOverrideEnabled,
        parsedArgs.disableExpirationCheck
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
    parsedArgs: IBundlerArgs
    logger: Logger
    metrics: Metrics
}): MemoryMempool => {
    return new MemoryMempool(
        monitor,
        reputationManager,
        validator,
        client,
        parsedArgs.safeMode,
        logger.child(
            { module: "mempool" },
            { level: parsedArgs.mempoolLogLevel || parsedArgs.logLevel }
        ),
        metrics
    )
}

const getCompressionHandler = async ({
    client,
    parsedArgs
}: {
    client: PublicClient<Transport, Chain>
    parsedArgs: IBundlerArgs
}): Promise<CompressionHandler | null> => {
    let compressionHandler: CompressionHandler | null = null
    if (
        parsedArgs.bundleBulkerAddress !== undefined &&
        parsedArgs.perOpInflatorAddress !== undefined
    ) {
        compressionHandler = await CompressionHandler.createAsync(
            parsedArgs.bundleBulkerAddress,
            parsedArgs.perOpInflatorAddress,
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
    parsedArgs: IBundlerArgs
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
        parsedArgs.entryPoints,
        logger.child(
            { module: "executor" },
            { level: parsedArgs.executorLogLevel || parsedArgs.logLevel }
        ),
        metrics,
        compressionHandler,
        gasPriceManager,
        !parsedArgs.tenderlyEnabled,
        parsedArgs.noEip1559Support,
        parsedArgs.customGasLimitForEstimation,
        parsedArgs.useUserOperationGasLimitsForSubmission
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
    parsedArgs: IBundlerArgs
    logger: Logger
    metrics: Metrics
    gasPriceManager: GasPriceManager
}) => {
    return new ExecutorManager(
        executor,
        parsedArgs.entryPoints,
        mempool,
        monitor,
        reputationManager,
        client,
        parsedArgs.pollingInterval,
        logger.child(
            { module: "executor" },
            { level: parsedArgs.executorLogLevel || parsedArgs.logLevel }
        ),
        metrics,
        parsedArgs.bundleMode,
        parsedArgs.bundlerFrequency,
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
    parsedArgs: IBundlerArgs
    logger: Logger
}) => {
    return new NonceQueuer(
        mempool,
        client,
        logger.child(
            { module: "nonce_queuer" },
            { level: parsedArgs.nonceQueuerLogLevel || parsedArgs.logLevel }
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
    parsedArgs: IBundlerArgs
    logger: Logger
    metrics: Metrics
    compressionHandler: CompressionHandler | null
    gasPriceManager: GasPriceManager
}) => {
    return new RpcHandler(
        parsedArgs.entryPoints,
        client,
        validator,
        mempool,
        executor,
        monitor,
        nonceQueuer,
        executorManager,
        reputationManager,
        parsedArgs.tenderlyEnabled ?? false,
        parsedArgs.minimumGasPricePercent,
        parsedArgs.apiVersion,
        parsedArgs.noEthCallOverrideSupport,
        parsedArgs.rpcMaxBlockRange,
        logger.child(
            { module: "rpc" },
            { level: parsedArgs.rpcLogLevel || parsedArgs.logLevel }
        ),
        metrics,
        parsedArgs.environment,
        compressionHandler,
        parsedArgs.noEip1559Support,
        gasPriceManager,
        parsedArgs.dangerousSkipUserOperationValidation
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
    parsedArgs: IBundlerArgs
    logger: Logger
    registry: Registry
    metrics: Metrics
}) => {
    return new Server(
        rpcEndpoint,
        parsedArgs.port,
        parsedArgs.requestTimeout,
        logger.child(
            { module: "rpc" },
            { level: parsedArgs.rpcLogLevel || parsedArgs.logLevel }
        ),
        registry,
        metrics,
        parsedArgs.environment
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
    parsedArgs: IBundlerArgs
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
        parsedArgs.minBalance
    )

    setInterval(async () => {
        await senderManager.validateAndRefillWallets(
            client,
            walletClient,
            parsedArgs.minBalance
        )
    }, parsedArgs.refillInterval)

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

    if (parsedArgs.flushStuckTransactionsDuringStartup) {
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
