import {
    createMetrics,
    initDebugLogger,
    initProductionLogger
} from "@alto/utils"
import {
    BasicExecutor,
    ExecutorManager,
    SenderManager
} from "@entrypoint-0.6/executor"
import {
    MemoryMempool,
    Monitor,
    NullRepuationManager,
    ReputationManager,
    type InterfaceReputationManager
} from "@entrypoint-0.6/mempool"
import {
    NonceQueuer,
    RpcHandler,
    SafeValidator,
    Server,
    UnsafeValidator
} from "@entrypoint-0.6/rpc"
import type { InterfaceValidator } from "@entrypoint-0.6/types"
import { CompressionHandler, type Logger } from "@entrypoint-0.6/utils"
import { Registry } from "prom-client"
import {
    createPublicClient,
    createWalletClient,
    type Chain,
    type PublicClient,
    type Transport
} from "viem"
import { fromZodError } from "zod-validation-error"
import {
    bundlerArgsSchema,
    type IBundlerArgs,
    type IBundlerArgsInput
} from "./config"
import { customTransport } from "./customTransport"

const parseArgs = (args: IBundlerArgsInput): IBundlerArgs => {
    // validate every arg, make typesafe so if i add a new arg i have to validate it
    const parsing = bundlerArgsSchema.safeParse(args)
    if (!parsing.success) {
        const error = fromZodError(parsing.error)
        throw new Error(error.message)
    }

    return parsing.data
}

const preFlightChecks = async (
    publicClient: PublicClient<Transport, Chain>,
    args: IBundlerArgs
): Promise<void> => {
    const entryPointCode = await publicClient.getBytecode({
        address: args.entryPoint
    })
    if (entryPointCode === "0x") {
        throw new Error(`entry point ${args.entryPoint} does not exist`)
    }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
export async function bundlerHandler(args: IBundlerArgsInput): Promise<void> {
    const parsedArgs = parseArgs(args)
    if (parsedArgs.signerPrivateKeysExtra !== undefined) {
        parsedArgs.signerPrivateKeys = [
            ...parsedArgs.signerPrivateKeys,
            ...parsedArgs.signerPrivateKeysExtra
        ]
    }

    let logger: Logger
    if (parsedArgs.logEnvironment === "development") {
        logger = initDebugLogger(parsedArgs.logLevel)
    } else {
        logger = initProductionLogger(parsedArgs.logLevel)
    }
    const rootLogger = logger.child(
        { module: "root" },
        { level: parsedArgs.logLevel }
    )

    const getChainId = async () => {
        const client = createPublicClient({
            transport: customTransport(args.rpcUrl, {
                logger: logger.child(
                    { module: "public_client" },
                    {
                        level:
                            parsedArgs.publicClientLogLevel ||
                            parsedArgs.logLevel
                    }
                )
            })
        })
        return await client.getChainId()
    }
    const chainId = await getChainId()

    const chain: Chain = {
        id: chainId,
        name: args.networkName,
        network: args.networkName,
        nativeCurrency: {
            name: "ETH",
            symbol: "ETH",
            decimals: 18
        },
        rpcUrls: {
            default: { http: [args.rpcUrl] },
            public: { http: [args.rpcUrl] }
        }
    }

    const client = createPublicClient({
        transport: customTransport(args.rpcUrl, {
            logger: logger.child(
                { module: "public_client" },
                {
                    level:
                        parsedArgs.publicClientLogLevel || parsedArgs.logLevel
                }
            )
        }),
        chain
    })

    const registry = new Registry()
    registry.setDefaultLabels({ network: chain.name, chainId })
    const metrics = createMetrics(registry)

    await preFlightChecks(client, parsedArgs)

    const walletClient = createWalletClient({
        transport: customTransport(parsedArgs.executionRpcUrl ?? args.rpcUrl, {
            logger: logger.child(
                { module: "wallet_client" },
                {
                    level:
                        parsedArgs.walletClientLogLevel || parsedArgs.logLevel
                }
            )
        }),
        chain
    })

    const senderManager = new SenderManager(
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

    let validator: InterfaceValidator
    let reputationManager: InterfaceReputationManager

    if (parsedArgs.safeMode) {
        reputationManager = new ReputationManager(
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

        validator = new SafeValidator(
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
    } else {
        reputationManager = new NullRepuationManager()
        validator = new UnsafeValidator(
            client,
            parsedArgs.entryPoint,
            logger.child(
                { module: "rpc" },
                { level: parsedArgs.rpcLogLevel || parsedArgs.logLevel }
            ),
            metrics,
            parsedArgs.utilityPrivateKey,
            parsedArgs.apiVersion,
            parsedArgs.noEip1559Support,
            parsedArgs.tenderlyEnabled,
            parsedArgs.balanceOverrideEnabled,
            parsedArgs.disableExpirationCheck
        )
    }

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

    const monitor = new Monitor()
    const mempool = new MemoryMempool(
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

    const { bundleBulkerAddress, perOpInflatorAddress } = parsedArgs

    let compressionHandler = null
    if (
        bundleBulkerAddress !== undefined &&
        perOpInflatorAddress !== undefined
    ) {
        compressionHandler = await CompressionHandler.createAsync(
            bundleBulkerAddress,
            perOpInflatorAddress,
            client
        )
    }

    const executor = new BasicExecutor(
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

    const executorManager = new ExecutorManager(
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

    const nonceQueuer = new NonceQueuer(
        mempool,
        client,
        parsedArgs.entryPoint,
        logger.child(
            { module: "nonce_queuer" },
            { level: parsedArgs.nonceQueuerLogLevel || parsedArgs.logLevel }
        )
    )

    const rpcEndpoint = new RpcHandler(
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

    if (parsedArgs.flushStuckTransactionsDuringStartup) {
        executor.flushStuckTransactions()
    }

    rootLogger.info(
        `Initialized ${senderManager.wallets.length} executor wallets`
    )

    const server = new Server(
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
    await server.start()

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
