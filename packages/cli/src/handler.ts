import { fromZodError } from "zod-validation-error"
import {
    IBundlerArgs,
    IBundlerArgsInput,
    RpcHandlerConfig,
    bundlerArgsSchema,
    bundlerArgsToRpcHandlerConfig
} from "@alto/config"
import { RpcHandler, Server } from "@alto/api"
import { UnsafeValidator } from "@alto/validator"
import { BasicExecutor } from "@alto/executor"
import { createWalletClient, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const parseArgs = (args: IBundlerArgsInput): IBundlerArgs => {
    // validate every arg, make typesafe so if i add a new arg i have to validate it
    const parsing = bundlerArgsSchema.safeParse(args)
    if (!parsing.success) {
        const error = fromZodError(parsing.error)
        throw new Error(error.message)
    }

    return parsing.data
}

export const bundlerHandler = async (args: IBundlerArgsInput): Promise<void> => {
    const parsedArgs = parseArgs(args)
    const walletClient = createWalletClient({
        transport: http(parsedArgs.rpcUrl)
    })
    const signerAccount = privateKeyToAccount(parsedArgs.signerPrivateKey)
    const handlerConfig: RpcHandlerConfig = await bundlerArgsToRpcHandlerConfig(parsedArgs)
    const client = handlerConfig.publicClient
    const validator = new UnsafeValidator(handlerConfig.publicClient, parsedArgs.entryPoint)
    const executor = new BasicExecutor(parsedArgs.beneficiary, client, walletClient, signerAccount)
    const rpcEndpoint = new RpcHandler(handlerConfig, validator, executor)

    const server = new Server(rpcEndpoint, parsedArgs)
    await server.start()
}
