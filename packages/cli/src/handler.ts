import { RpcHandler, Server } from "@alto/api"
import {
    IBundlerArgs,
    IBundlerArgsInput,
    RpcHandlerConfig,
    bundlerArgsSchema,
    bundlerArgsToRpcHandlerConfig
} from "@alto/config"
import { BasicExecutor, SenderManager } from "@alto/executor"
import { Monitor } from "@alto/executor"
import { Logger, initDebugLogger, initProductionLogger } from "@alto/utils"
import { createMetrics } from "@alto/utils"
import { UnsafeValidator } from "@alto/validator"
import { Chain, PublicClient, createPublicClient, createWalletClient, http } from "viem"
import * as chains from "viem/chains"
import { fromZodError } from "zod-validation-error"
import { Registry } from "prom-client"

const parseArgs = (args: IBundlerArgsInput): IBundlerArgs => {
    // validate every arg, make typesafe so if i add a new arg i have to validate it
    const parsing = bundlerArgsSchema.safeParse(args)
    if (!parsing.success) {
        const error = fromZodError(parsing.error)
        throw new Error(error.message)
    }

    return parsing.data
}

const preFlightChecks = async (publicClient: PublicClient, args: IBundlerArgs): Promise<void> => {
    const entryPointCode = await publicClient.getBytecode({ address: args.entryPoint })
    if (entryPointCode === "0x") {
        throw new Error(`entry point ${args.entryPoint} does not exist`)
    }
}

const customTestnet: Chain = {
    id: 36865,
    name: "Custom Testnet",
    network: "custom-testnet",
    nativeCurrency: {
        name: "Ether",
        symbol: "ETH",
        decimals: 18
    },
    rpcUrls: {
        default: {
            http: ["http://127.0.0.1:8545"]
        },
        public: {
            http: ["http://127.0.0.1:8545"]
        }
    },
    testnet: true
}

const dfkTestnet: Chain = {
    id: 335,
    name: "DFK Subnet Testnet",
    network: "dfk-testnet",
    nativeCurrency: {
        name: "JEWEL",
        symbol: "JEWEL",
        decimals: 18
    },
    rpcUrls: {
        default: {
            http: ["https://subnets.avax.network/defi-kingdoms/dfk-chain-testnet/rpc"]
        },
        public: {
            http: ["https://subnets.avax.network/defi-kingdoms/dfk-chain-testnet/rpc"]
        }
    },
    testnet: true
}

const linea: Chain = {
    id: 59144,
    name: "Linea Mainnet",
    network: "linea",
    nativeCurrency: {
        name: "ETH",
        symbol: "ETH",
        decimals: 18
    },
    rpcUrls: {
        default: {
            http: []
        },
        public: {
            http: []
        }
    },
    testnet: false
}

const base: Chain = {
    id: 8453,
    name: "Base Mainnet",
    network: "base",
    nativeCurrency: {
        name: "ETH",
        symbol: "ETH",
        decimals: 18
    },
    rpcUrls: {
        default: {
            http: []
        },
        public: {
            http: []
        }
    },
    testnet: false
}

function getChain(chainId: number) {
    if (chainId === 36865) {
        return customTestnet
    }

    if (chainId === 8453) {
        return base
    }

    if (chainId === 335) {
        return dfkTestnet
    }

    if (chainId === 59144) {
        return linea
    }

    for (const chain of Object.values(chains)) {
        if (chain.id === chainId) {
            return chain
        }
    }

    throw new Error(`Chain with id ${chainId} not found`)
}

export const bundlerHandler = async (args: IBundlerArgsInput): Promise<void> => {
    const parsedArgs = parseArgs(args)
    if (parsedArgs.signerPrivateKeysExtra !== undefined) {
        parsedArgs.signerPrivateKeys = [...parsedArgs.signerPrivateKeys, ...parsedArgs.signerPrivateKeysExtra]
    }
    const handlerConfig: RpcHandlerConfig = await bundlerArgsToRpcHandlerConfig(parsedArgs)

    const getChainId = async () => {
        const client = createPublicClient({
            transport: http(args.rpcUrl)
        })
        return await client.getChainId()
    }
    const chainId = await getChainId()

    const chain = getChain(chainId)
    const client = createPublicClient({
        transport: http(args.rpcUrl),
        chain
    })

    const registry = new Registry()
    const metrics = createMetrics(registry, chainId, parsedArgs.environment)
    metrics.walletsAvailable.set(69)

    await preFlightChecks(client, parsedArgs)

    const walletClient = createWalletClient({
        transport: http(parsedArgs.rpcUrl),
        chain
    })
    let logger: Logger
    if (parsedArgs.logEnvironment === "development") {
        logger = initDebugLogger(parsedArgs.logLevel)
    } else {
        logger = initProductionLogger(
            parsedArgs.logLevel,
            chainId,
            parsedArgs.environment,
            parsedArgs.lokiHost,
            parsedArgs.lokiUsername,
            parsedArgs.lokiPassword
        )
    }
    const validator = new UnsafeValidator(
        client,
        parsedArgs.entryPoint,
        logger,
        metrics,
        parsedArgs.utilityPrivateKey,
        parsedArgs.tenderlyEnabled
    )
    const senderManager = new SenderManager(
        parsedArgs.signerPrivateKeys,
        parsedArgs.utilityPrivateKey,
        logger,
        metrics,
        parsedArgs.maxSigners
    )

    await senderManager.validateAndRefillWallets(client, walletClient, parsedArgs.minBalance)

    setInterval(async () => {
        await senderManager.validateAndRefillWallets(client, walletClient, parsedArgs.minBalance)
    }, parsedArgs.refillInterval)

    const monitor = new Monitor()

    const executor = new BasicExecutor(
        parsedArgs.beneficiary,
        client,
        walletClient,
        senderManager,
        monitor,
        parsedArgs.entryPoint,
        parsedArgs.pollingInterval,
        logger,
        metrics,
        !parsedArgs.tenderlyEnabled
    )
    const rpcEndpoint = new RpcHandler(handlerConfig, client, validator, executor, monitor, logger, metrics)

    executor.flushStuckTransactions()

    logger.info(`Initialized ${senderManager.wallets.length} executor wallets`)

    const server = new Server(rpcEndpoint, parsedArgs, logger, registry)
    await server.start()
}
