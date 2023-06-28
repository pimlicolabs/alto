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
import { UnsafeValidator } from "@alto/validator"
import { Chain, PublicClient, createWalletClient, http } from "viem"
import * as chains from "viem/chains"
import { fromZodError } from "zod-validation-error"

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

function getChain(chainId: number) {
    if (chainId === 36865) {
        return customTestnet
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
    const handlerConfig: RpcHandlerConfig = await bundlerArgsToRpcHandlerConfig(parsedArgs)
    const client = handlerConfig.publicClient

    const chainId = await client.getChainId()
    const chain = getChain(chainId)

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
        handlerConfig.publicClient,
        parsedArgs.entryPoint,
        logger,
        parsedArgs.tenderlyEnabled
    )
    const senderManager = new SenderManager(
        parsedArgs.signerPrivateKeys,
        parsedArgs.utilityPrivateKey,
        logger,
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
        !parsedArgs.tenderlyEnabled
    )
    const rpcEndpoint = new RpcHandler(handlerConfig, validator, executor, monitor, logger)

    await executor.flushStuckTransactions()

    const server = new Server(rpcEndpoint, parsedArgs, logger)
    await server.start()
}
