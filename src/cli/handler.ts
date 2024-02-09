import {
    type Logger,
    createMetrics,
    initDebugLogger,
    initProductionLogger
} from "@alto/utils"
import { Registry } from "prom-client"
import {
    type Chain,
    type PublicClient,
    type Transport,
    createPublicClient,
    createWalletClient
} from "viem"
import { fromZodError } from "zod-validation-error"
import {
    type IBundlerArgs,
    type IBundlerArgsInput,
    bundlerArgsSchema
} from "./config"
import { customTransport } from "./customTransport"
import {
    getCompressionHandler,
    getExecutor,
    getExecutorManager,
    getMempool,
    getMonitor,
    getNonceQueuer,
    getReputationManager,
    getRpcHandler,
    getSenderManager,
    getServer,
    getValidator
} from "./helper"

const parseArgs = (args: IBundlerArgsInput): IBundlerArgs => {
    // validate every arg, make type safe so if i add a new arg i have to validate it
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

    const senderManager = getSenderManager({ parsedArgs, logger, metrics })

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
