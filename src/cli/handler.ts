import { GasPriceManager } from "@alto/handlers"
import {
    createMetrics,
    initDebugLogger,
    initProductionLogger
} from "@alto/utils"
import { Registry } from "prom-client"
import {
    type CallParameters,
    type Chain,
    createPublicClient,
    createWalletClient,
    fallback,
    formatEther,
    publicActions
} from "viem"
import * as chains from "viem/chains"
import { type AltoConfig, createConfig } from "../createConfig"
import { getSenderManager } from "../executor/senderManager/index"
import { UtilityWalletMonitor } from "../executor/utilityWalletMonitor"
import type { IOptionsInput } from "./config"
import { customTransport } from "./customTransport"
import { deploySimulationsContract } from "./deploySimulationsContract"
import { parseArgs } from "./parseArgs"
import { setupServer } from "./setupServer"

const preFlightChecks = async (config: AltoConfig): Promise<void> => {
    // Check horizontal scaling configuration
    if (config.enableHorizontalScaling && !config.redisEndpoint) {
        throw new Error(
            "Horizontal scaling is enabled but redis-endpoint is not configured."
        )
    }

    // Check Redis receipt cache configuration
    if (config.enableRedisReceiptCache && !config.redisEndpoint) {
        throw new Error(
            "Redis receipt cache is enabled but redis-endpoint is not configured."
        )
    }

    for (const entrypoint of config.entrypoints) {
        const entryPointCode = await config.publicClient.getCode({
            address: entrypoint
        })
        if (entryPointCode === undefined || entryPointCode === "0x") {
            throw new Error(`entry point ${entrypoint} does not exist`)
        }
    }

    if (config.pimlicoSimulationContract) {
        const address = config.pimlicoSimulationContract
        const code = await config.publicClient.getCode({
            address: address
        })
        if (code === undefined || code === "0x") {
            throw new Error(
                `PimlicoSimulations contract ${address} does not exist`
            )
        }
    }

    if (config.entrypointSimulationContractV7) {
        const address = config.entrypointSimulationContractV7
        const code = await config.publicClient.getCode({
            address
        })
        if (code === undefined || code === "0x") {
            throw new Error(
                `EntryPointSimulationsV7 contract ${address} does not exist`
            )
        }
    }

    // if (config.entrypointSimulationContractV8) {
    //     const simulations = config.entrypointSimulationContractV8
    //     const simulationsCode = await config.publicClient.getCode({
    //         address: simulations
    //     })
    //     if (simulationsCode === undefined || simulationsCode === "0x") {
    //         throw new Error(
    //             `EntryPointSimulationsV8 contract ${simulations} does not exist`
    //         )
    //     }
    // }

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

const getViemChain = ({
    chainId,
    args
}: { chainId: number; args: ReturnType<typeof parseArgs> }) => {
    for (const chain of Object.values(chains)) {
        if (chain.id === chainId) {
            return {
                ...chain,
                blockTime: chain.blockTime ?? args.blockTime,
                rpcUrls: {
                    default: { http: [args.rpcUrl] },
                    public: { http: [args.rpcUrl] }
                }
            }
        }
    }
    return null
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

    // let us assume that the block time is at least 2x the polling interval
    const viemChain = getViemChain({ chainId, args })

    const chain: Chain = viemChain ?? {
        id: chainId,
        name: "chain-name", // isn't important, never used
        nativeCurrency: {
            name: "ETH",
            symbol: "ETH",
            decimals: 18
        },
        blockTime: args.blockTime,
        rpcUrls: {
            default: { http: [args.rpcUrl] },
            public: { http: [args.rpcUrl] }
        },
        experimental_preconfirmationTime: args.flashblocksPreconfirmationTime
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
        pollingInterval: args.blockTime / 4,
        chain
    })

    // Some permissioned chains require a whitelisted address to make deployments.
    // In order for simulations to work, we need to make our eth_call's from a whitelisted address.
    if (args.ethCallSenderAddress) {
        const whitelistedSender = args.ethCallSenderAddress
        publicClient = publicClient
            .extend((client) => ({
                async call(args: CallParameters) {
                    args.account = whitelistedSender
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

    const walletClients = {
        private: args.sendTransactionRpcUrl
            ? createWalletClient({
                  transport: fallback(
                      [
                          createWalletTransport(args.sendTransactionRpcUrl),
                          createWalletTransport(args.rpcUrl)
                      ],
                      { rank: false }
                  ),
                  chain
              })
            : undefined,
        public: createWalletClient({
            transport: createWalletTransport(args.rpcUrl),
            chain
        })
    }

    // if flag is set, use utility wallet to deploy the simulations contract
    if (args.deploySimulationsContract) {
        const deployedContracts = await deploySimulationsContract({
            logger,
            args,
            publicClient
        })
        args.entrypointSimulationContractV7 =
            deployedContracts.entrypointSimulationContractV7
        args.entrypointSimulationContractV8 =
            deployedContracts.entrypointSimulationContractV8
        args.pimlicoSimulationContract =
            deployedContracts.pimlicoSimulationContract
        logger.info(
            {
                entrypointSimulationContractV7:
                    deployedContracts.entrypointSimulationContractV7,
                entrypointSimulationContractV8:
                    deployedContracts.entrypointSimulationContractV8,
                pimlicoSimulationContract:
                    deployedContracts.pimlicoSimulationContract
            },
            "Contracts used for simulation"
        )
    }

    const config = createConfig({
        ...args,
        logger,
        publicClient,
        walletClients
    })

    const gasPriceManager = new GasPriceManager(config)

    await gasPriceManager.init()

    const registry = new Registry()
    const metrics = createMetrics(registry)

    await preFlightChecks(config)

    const senderManager = await getSenderManager({
        config,
        metrics
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
