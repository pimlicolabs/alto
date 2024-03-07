import {
    type Logger,
    createMetrics,
    initDebugLogger,
    initProductionLogger,
    GasPriceManager
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
import { setupEntryPointPointSix } from "@entrypoint-0.6/cli"
import { SenderManager } from "@alto/executor"
import { setupEntryPointPointSeven } from "@entrypoint-0.7/cli"

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

    const gasPriceManager = new GasPriceManager(
        chain,
        client,
        parsedArgs.noEip1559Support,
        logger.child(
            { module: "gas_price_manager" },
            {
                level: parsedArgs.publicClientLogLevel || parsedArgs.logLevel
            }
        ),
        parsedArgs.gasPriceTimeValidityInSeconds
    )

    const registry = new Registry()
    registry.setDefaultLabels({
        network: chain.name,
        chainId,
        entrypoint_version: parsedArgs.entryPointVersion
    })
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
        gasPriceManager,
        parsedArgs.maxSigners
    )

    if (parsedArgs.entryPointVersion === "0.6") {
        await setupEntryPointPointSix({
            client,
            walletClient,
            parsedArgs,
            logger,
            rootLogger,
            registry,
            metrics,
            senderManager,
            gasPriceManager
        })
    }
    if (parsedArgs.entryPointVersion === "0.7") {
        await setupEntryPointPointSeven({
            client,
            walletClient,
            parsedArgs,
            logger,
            rootLogger,
            registry,
            metrics,
            senderManager,
            gasPriceManager
        })
    }
}
