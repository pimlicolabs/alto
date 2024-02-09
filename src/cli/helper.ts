import type { Logger } from "@alto/utils"
import type { IBundlerArgs } from "./config"
import type { Metrics } from "@alto/utils"
import { SenderManager } from "@alto/executor"
import {
    NullReputationManager,
    ReputationManager,
    Monitor,
    MemoryMempool,
    type Mempool,
    type InterfaceReputationManager
} from "@entrypoint-0.6/mempool"
import type { Chain, PublicClient, Transport, WalletClient } from "viem"
import {
    NonceQueuer,
    RpcHandler,
    SafeValidator,
    Server,
    UnsafeValidator
} from "@entrypoint-0.6/rpc"
import type { InterfaceValidator } from "@entrypoint-0.6/types"
import { CompressionHandler } from "@entrypoint-0.6/utils"
import {
    BasicExecutor,
    ExecutorManager,
    type IExecutor
} from "@entrypoint-0.6/executor"
import type { Registry } from "prom-client"

export const getSenderManager = ({
    parsedArgs,
    logger,
    metrics
}: {
    parsedArgs: IBundlerArgs
    logger: Logger
    metrics: Metrics
}): SenderManager => {
    return new SenderManager(
        parsedArgs.signerPrivateKeys,
        parsedArgs.utilityPrivateKey,
        logger.child(
            { module: "executor" },
            { level: parsedArgs.executorLogLevel || parsedArgs.logLevel }
        ),
        metrics,
        parsedArgs.noEip1559Support,
        parsedArgs.apiVersion,
        parsedArgs.maxSigners
    )
}

export const getReputationManager = ({
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

export const getValidator = ({
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

export const getMonitor = (): Monitor => {
    return new Monitor()
}

export const getMempool = ({
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

export const getCompressionHandler = async ({
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

export const getExecutor = ({
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

export const getExecutorManager = ({
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

export const getNonceQueuer = ({
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

export const getRpcHandler = ({
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

export const getServer = ({
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
