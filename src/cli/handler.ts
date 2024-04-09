import { SenderManager } from "@alto/executor"
import {
    GasPriceManager,
    createMetrics,
    initDebugLogger,
    initProductionLogger,
    type Logger
} from "@alto/utils"
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
    optionArgsSchema,
    type IBundlerArgs,
    type IOptions,
    type IOptionsInput
} from "./config"
import { customTransport } from "./customTransport"
import { setupServer } from "./setupServer"

const parseArgs = (args: IOptionsInput): IOptions => {
    // validate every arg, make type safe so if i add a new arg i have to validate it
    const parsing = optionArgsSchema.safeParse(args)
    if (!parsing.success) {
        const error = fromZodError(parsing.error)
        throw new Error(error.message)
    }

    return parsing.data
}

const preFlightChecks = async (
    publicClient: PublicClient<Transport, Chain>,
    parsedArgs: IBundlerArgs
): Promise<void> => {
    for (const entrypoint of parsedArgs.entrypoints) {
        const entryPointCode = await publicClient.getBytecode({
            address: entrypoint
        })
        if (entryPointCode === "0x") {
            throw new Error(`entry point ${entrypoint} does not exist`)
        }
    }
}

export async function bundlerHandler(args: IOptionsInput): Promise<void> {
    const parsedArgs = parseArgs(args)

    let logger: Logger
    if (parsedArgs.json) {
        logger = initProductionLogger(parsedArgs["log-level"])
    } else {
        logger = initDebugLogger(parsedArgs["log-level"])
    }

    const rootLogger = logger.child(
        { module: "root" },
        { level: parsedArgs["log-level"] }
    )

    const getChainId = async () => {
        const client = createPublicClient({
            transport: customTransport(args["rpc-url"], {
                logger: logger.child(
                    { module: "public_client" },
                    {
                        level:
                            parsedArgs["public-client-log-level"] ||
                            parsedArgs["log-level"]
                    }
                )
            })
        })
        return await client.getChainId()
    }
    const chainId = await getChainId()

    const chain: Chain = {
        id: chainId,
        name: args["network-name"],
        nativeCurrency: {
            name: "ETH",
            symbol: "ETH",
            decimals: 18
        },
        rpcUrls: {
            default: { http: [args["rpc-url"]] },
            public: { http: [args["rpc-url"]] }
        }
    }

    const client = createPublicClient({
        transport: customTransport(args["rpc-url"], {
            logger: logger.child(
                { module: "public_client" },
                {
                    level:
                        parsedArgs["public-client-log-level"] ||
                        parsedArgs["log-level"]
                }
            )
        }),
        chain
    })

    const gasPriceManager = new GasPriceManager(
        chain,
        client,
        parsedArgs["legacy-transactions"],
        logger.child(
            { module: "gas_price_manager" },
            {
                level:
                    parsedArgs["public-client-log-level"] ||
                    parsedArgs["log-level"]
            }
        ),
        parsedArgs["gas-price-expiry"]
    )

    const registry = new Registry()
    registry.setDefaultLabels({
        network: chain.name,
        chainId
    })
    const metrics = createMetrics(registry)

    await preFlightChecks(client, parsedArgs)

    const walletClient = createWalletClient({
        transport: customTransport(
            parsedArgs["send-transaction-rpc-url"] ?? args["rpc-url"],
            {
                logger: logger.child(
                    { module: "wallet_client" },
                    {
                        level:
                            parsedArgs["wallet-client-log-level"] ||
                            parsedArgs["log-level"]
                    }
                )
            }
        ),
        chain
    })

    const senderManager = new SenderManager(
        parsedArgs["executor-private-keys"],
        parsedArgs["utility-private-key"],
        logger.child(
            { module: "executor" },
            {
                level:
                    parsedArgs["executor-log-level"] || parsedArgs["log-level"]
            }
        ),
        metrics,
        parsedArgs["legacy-transactions"],
        gasPriceManager,
        parsedArgs["max-executors"]
    )

    await setupServer({
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
