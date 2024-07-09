import { SenderManager } from "@alto/executor"
import {
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
    type Transport,
    http,
    formatEther
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
import { PimlicoEntryPointSimulationsDeployBytecode } from "../types/contracts"
import { UtilityWalletMonitor } from "../executor/utilityWalletMonitor"
import { GasPriceManager } from "@alto/handlers"

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

    if (parsedArgs["entrypoint-simulation-contract"]) {
        const simulations = parsedArgs["entrypoint-simulation-contract"]
        const simulationsCode = await publicClient.getBytecode({
            address: simulations
        })
        if (simulationsCode === undefined || simulationsCode === "0x") {
            throw new Error(
                `EntryPointSimulations contract ${simulations} does not exist`
            )
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
            transport: customTransport(parsedArgs["rpc-url"], {
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

    // if flag is set, use utility wallet to deploy the simulations contract
    if (parsedArgs["deploy-simulations-contract"]) {
        if (!parsedArgs["utility-private-key"]) {
            throw new Error(
                "Cannot deploy entryPoint simulations without utility-private-key"
            )
        }

        const walletClient = createWalletClient({
            transport: http(args["rpc-url"]),
            account: parsedArgs["utility-private-key"]
        })

        const deployHash = await walletClient.deployContract({
            chain,
            abi: [],
            bytecode: PimlicoEntryPointSimulationsDeployBytecode
        })

        const receipt = await client.getTransactionReceipt({
            hash: deployHash
        })

        const simulationsContract = receipt.contractAddress

        if (simulationsContract === null) {
            throw new Error("Failed to deploy simulationsContract")
        }

        parsedArgs["entrypoint-simulation-contract"] = simulationsContract
    }

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
        parsedArgs["gas-price-bump"],
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

    const utilityWalletAddress = parsedArgs["utility-private-key"]?.address

    if (utilityWalletAddress && parsedArgs["utility-wallet-monitor"]) {
        const utilityWalletMonitor = new UtilityWalletMonitor(
            client,
            parsedArgs["utility-wallet-monitor-interval"],
            utilityWalletAddress,
            metrics,
            logger.child(
                { module: "utility_wallet_monitor" },
                {
                    level: parsedArgs["log-level"]
                }
            )
        )

        await utilityWalletMonitor.start()
    }

    metrics.executorWalletsMinBalance.set(
        Number.parseFloat(formatEther(parsedArgs["min-executor-balance"] || 0n))
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
