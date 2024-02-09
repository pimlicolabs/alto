import type { Logger } from "@alto/utils"
import type { IBundlerArgs } from "@alto/cli"
import type { Metrics } from "@alto/utils"
import {
    NullReputationManager,
    ReputationManager,
    Monitor,
    MemoryMempool,
    type Mempool,
    type InterfaceReputationManager
} from "@entrypoint-0.7/mempool"
import type { Chain, PublicClient, Transport, WalletClient } from "viem"
import {
    NonceQueuer,
    RpcHandler,
    SafeValidator,
    Server,
    UnsafeValidator
} from "@entrypoint-0.7/rpc"
import type { InterfaceValidator } from "@entrypoint-0.7/types"
import { CompressionHandler } from "@entrypoint-0.7/utils"
import {
    BasicExecutor,
    ExecutorManager,
    type IExecutor
} from "@entrypoint-0.7/executor"
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
            parsedArgs.entryPoint,
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
    metrics
}: {
    client: PublicClient<Transport, Chain>
    parsedArgs: IBundlerArgs
    logger: Logger
    senderManager: SenderManager
    metrics: Metrics
}): InterfaceValidator => {
    if (parsedArgs.safeMode) {
        return new SafeValidator(
            client,
            senderManager,
            parsedArgs.entryPoint,
            logger.child(
                { module: "rpc" },
                { level: parsedArgs.rpcLogLevel || parsedArgs.logLevel }
            ),
            metrics,
            parsedArgs.utilityPrivateKey,
            parsedArgs.apiVersion,
            parsedArgs.tenderlyEnabled,
            parsedArgs.balanceOverrideEnabled
        )
    }
    return new UnsafeValidator(
        client,
        parsedArgs.entryPoint,
        logger.child(
            { module: "rpc" },
            { level: parsedArgs.rpcLogLevel || parsedArgs.logLevel }
        ),
        metrics,
        parsedArgs.utilityPrivateKey,
        parsedArgs.apiVersion,
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
}): Mempool => {
    return new MemoryMempool(
        monitor,
        reputationManager,
        validator,
        client,
        parsedArgs.entryPoint,
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
    compressionHandler
}: {
    client: PublicClient<Transport, Chain>
    walletClient: WalletClient<Transport, Chain>
    senderManager: SenderManager
    reputationManager: InterfaceReputationManager
    parsedArgs: IBundlerArgs
    logger: Logger
    metrics: Metrics
    compressionHandler: CompressionHandler | null
}): IExecutor => {
    return new BasicExecutor(
        client,
        walletClient,
        senderManager,
        reputationManager,
        parsedArgs.entryPoint,
        logger.child(
            { module: "executor" },
            { level: parsedArgs.executorLogLevel || parsedArgs.logLevel }
        ),
        metrics,
        compressionHandler,
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
    metrics
}: {
    executor: IExecutor
    mempool: Mempool
    monitor: Monitor
    reputationManager: InterfaceReputationManager
    client: PublicClient<Transport, Chain>
    parsedArgs: IBundlerArgs
    logger: Logger
    metrics: Metrics
}) => {
    return new ExecutorManager(
        executor,
        mempool,
        monitor,
        reputationManager,
        client,
        parsedArgs.entryPoint,
        parsedArgs.pollingInterval,
        logger.child(
            { module: "executor" },
            { level: parsedArgs.executorLogLevel || parsedArgs.logLevel }
        ),
        metrics,
        parsedArgs.bundleMode,
        parsedArgs.bundlerFrequency,
        parsedArgs.noEip1559Support
    )
}

const getNonceQueuer = ({
    mempool,
    client,
    parsedArgs,
    logger
}: {
    mempool: Mempool
    client: PublicClient<Transport, Chain>
    parsedArgs: IBundlerArgs
    logger: Logger
}) => {
    return new NonceQueuer(
        mempool,
        client,
        parsedArgs.entryPoint,
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
    compressionHandler
}: {
    client: PublicClient<Transport, Chain>
    validator: InterfaceValidator
    mempool: Mempool
    executor: IExecutor
    monitor: Monitor
    nonceQueuer: NonceQueuer
    executorManager: ExecutorManager
    reputationManager: InterfaceReputationManager
    parsedArgs: IBundlerArgs
    logger: Logger
    metrics: Metrics
    compressionHandler: CompressionHandler | null
}) => {
    return new RpcHandler(
        parsedArgs.entryPoint,
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
        metrics
    )
}

export const setupEntryPointPointSeven = async ({
    client,
    walletClient,
    parsedArgs,
    logger,
    rootLogger,
    registry,
    metrics,
    senderManager
}: {
    client: PublicClient<Transport, Chain>
    walletClient: WalletClient<Transport, Chain>
    parsedArgs: IBundlerArgs
    logger: Logger
    rootLogger: Logger
    registry: Registry
    metrics: Metrics
    senderManager: SenderManager
}) => {
    const validator = getValidator({
        client,
        logger,
        parsedArgs,
        senderManager,
        metrics
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
        compressionHandler
    })

    const executorManager = getExecutorManager({
        executor,
        mempool,
        monitor,
        reputationManager,
        client,
        parsedArgs,
        logger,
        metrics
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
        compressionHandler
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

    console.log("start ni hua kya")
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
