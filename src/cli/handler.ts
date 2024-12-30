import { SenderManager } from "@alto/executor"
import { GasPriceManager } from "@alto/handlers"
import {
    createMetrics,
    initDebugLogger,
    initProductionLogger
} from "@alto/utils"
import { Registry } from "prom-client"
import {
    type Chain,
    createPublicClient,
    createWalletClient,
    formatEther,
    fallback,
    CallParameters,
    publicActions
} from "viem"
import { UtilityWalletMonitor } from "../executor/utilityWalletMonitor"
import type { IOptionsInput } from "./config"
import { customTransport } from "./customTransport"
import { setupServer } from "./setupServer"
import { type AltoConfig, createConfig } from "../createConfig"
import { parseArgs } from "./parseArgs"
import { deploySimulationsContract } from "./deploySimulationsContract"
import { eip7702Actions } from "viem/experimental"

const preFlightChecks = async (config: AltoConfig): Promise<void> => {
    for (const entrypoint of config.entrypoints) {
        const entryPointCode = await config.publicClient.getCode({
            address: entrypoint
        })
        if (entryPointCode === undefined || entryPointCode === "0x") {
            throw new Error(`entry point ${entrypoint} does not exist`)
        }
    }

    if (config.entrypointSimulationContract) {
        const simulations = config.entrypointSimulationContract
        const simulationsCode = await config.publicClient.getCode({
            address: simulations
        })
        if (simulationsCode === undefined || simulationsCode === "0x") {
            throw new Error(
                `EntryPointSimulations contract ${simulations} does not exist`
            )
        }
    }

    if (config.refillHelperContract) {
        const refillHelper = config.refillHelperContract
        const refillHelperCode = await config.publicClient.getCode({
            address: refillHelper
        })
        if (refillHelperCode === undefined || refillHelperCode === "0x") {
            throw new Error(
                `RefillHelper contract ${refillHelper} does not exist`
            )
        }
    }
}

export async function bundlerHandler(args_: IOptionsInput): Promise<void> {
    const args = parseArgs(args_)
    const logger = args.json
        ? initProductionLogger(args.logLevel)
        : initDebugLogger(args.logLevel)

    const getChainId = async () => {
        const client = createPublicClient({
            transport: customTransport(args.rpcUrl, {
                logger: logger.child(
                    { module: "public_client" },
                    {
                        level: args.publicClientLogLevel || args.logLevel
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

    let publicClient = createPublicClient({
        transport: customTransport(args.rpcUrl, {
            logger: logger.child(
                { module: "public_client" },
                {
                    level: args.publicClientLogLevel || args.logLevel
                }
            )
        }),
        chain
    })

    if (args.chainType === "skale") {
        // SKALE only allows white listed addresses to deploy contracts.
        publicClient = publicClient
            .extend((client) => ({
                async call(args: CallParameters) {
                    args.account = "0x4337000c2828F5260d8921fD25829F606b9E8680"
                    return await client.call(args)
                }
            }))
            .extend(publicActions)
    }

    const createWalletTransport = (url: string) =>
        customTransport(url, {
            logger: logger.child(
                { module: "wallet_client" },
                { level: args.walletClientLogLevel || args.logLevel }
            )
        })

    const walletClient = createWalletClient({
        transport: args.sendTransactionRpcUrl
            ? fallback(
                  [
                      createWalletTransport(args.sendTransactionRpcUrl),
                      createWalletTransport(args.rpcUrl)
                  ],
                  { rank: false }
              )
            : createWalletTransport(args.rpcUrl),
        chain
    }).extend(eip7702Actions())

    // if flag is set, use utility wallet to deploy the simulations contract
    if (args.deploySimulationsContract) {
        args.entrypointSimulationContract = await deploySimulationsContract({
            args,
            publicClient
        })
    }

    const config = createConfig({ ...args, logger, publicClient, walletClient })

    const gasPriceManager = new GasPriceManager(config)

    await gasPriceManager.init()

    const registry = new Registry()
    registry.setDefaultLabels({
        network: chain.name,
        chainId
    })
    const metrics = createMetrics(registry)

    await preFlightChecks(config)

    const senderManager = new SenderManager({
        config,
        metrics,
        gasPriceManager
    })

    const utilityWalletAddress = config.utilityPrivateKey?.address

    if (utilityWalletAddress && config.utilityWalletMonitor) {
        const utilityWalletMonitor = new UtilityWalletMonitor({
            config,
            metrics,
            utilityWalletAddress
        })

        await utilityWalletMonitor.start()
    }

    metrics.executorWalletsMinBalance.set(
        Number.parseFloat(formatEther(config.minExecutorBalance || 0n))
    )

    await setupServer({
        config,
        registry,
        metrics,
        senderManager,
        gasPriceManager
    })
}
