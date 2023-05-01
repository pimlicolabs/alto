import { RpcHandler, Server } from "@alto/api"
import {
    IBundlerArgs,
    IBundlerArgsInput,
    RpcHandlerConfig,
    bundlerArgsSchema,
    bundlerArgsToRpcHandlerConfig
} from "@alto/config"
import { BasicExecutor, SenderManager } from "@alto/executor"
import { Logger, initDebugLogger, initProductionLogger } from "@alto/utils"
import { UnsafeValidator } from "@alto/validator"
import { Chain, PublicClient, createWalletClient, http } from "viem"
import {
    arbitrum,
    arbitrumGoerli,
    baseGoerli,
    goerli,
    mainnet,
    optimism,
    optimismGoerli,
    polygon,
    polygonMumbai,
    scrollTestnet
} from "viem/chains"
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

    // check self balance
    const selfBalance = await publicClient.getBalance({ address: args.beneficiary })
    if (selfBalance < args.minBalance) {
        throw new Error(`self balance ${selfBalance} is less than minBalance ${args.minBalance}`)
    }
}

const lineaTestnet: Chain = {
    id: 59140,
    name: "Linea Testnet",
    network: "linea-testnet",
    nativeCurrency: {
        name: "Ether",
        symbol: "ETH",
        decimals: 18
    },
    rpcUrls: {
        default: {
            http: ["https://rpc.goerli.linea.build/"]
        },
        public: {
            http: ["https://rpc.goerli.linea.build/"]
        }
    },
    blockExplorers: {
        default: {
            name: "Linea Explorer",
            url: "https://explorer.goerli.linea.build/"
        }
    },
    testnet: true
}

// @ts-ignore
function getChain(chainId: number): Chain {
    for (const chain of Object.values(chains)) {
        if (chain.id === chainId) {
            return chain
        }
    }

    throw new Error(`Chain with id ${chainId} not found`)
}

const chainIdToChain: Record<number, Chain> = {
    1: mainnet,
    5: goerli,
    80001: polygonMumbai,
    137: polygon,
    420: optimismGoerli,
    10: optimism,
    421613: arbitrumGoerli,
    42161: arbitrum,
    84531: baseGoerli,
    534353: scrollTestnet,
    59140: lineaTestnet
}

export const bundlerHandler = async (args: IBundlerArgsInput): Promise<void> => {
    const parsedArgs = parseArgs(args)
    const handlerConfig: RpcHandlerConfig = await bundlerArgsToRpcHandlerConfig(parsedArgs)
    const client = handlerConfig.publicClient

    const chainId = await client.getChainId()
    const chain: Chain = chainIdToChain[chainId]

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
    const validator = new UnsafeValidator(handlerConfig.publicClient, parsedArgs.entryPoint)
    const senderManager = new SenderManager(parsedArgs.signerPrivateKeys, logger, parsedArgs.maxSigners)

    await senderManager.validateAndRefillWallets(
        client,
        walletClient,
        parsedArgs.minBalance,
        parsedArgs.utilityPrivateKey
    )

    const executor = new BasicExecutor(
        parsedArgs.beneficiary,
        client,
        walletClient,
        senderManager,
        parsedArgs.entryPoint,
        parsedArgs.pollingInterval,
        logger
    )
    const rpcEndpoint = new RpcHandler(handlerConfig, validator, executor, logger)

    const server = new Server(rpcEndpoint, parsedArgs, logger)
    await server.start()
}
