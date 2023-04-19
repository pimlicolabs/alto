import { fromZodError } from "zod-validation-error"
import {
    IBundlerArgs,
    IBundlerArgsInput,
    RpcHandlerConfig,
    bundlerArgsSchema,
    bundlerArgsToRpcHandlerConfig
} from "@alto/config"
import { RpcHandler, Server } from "@alto/api"
import { EmptyValidator, IValidator } from "@alto/validator"
import { MemoryMempool } from "@alto/mempool"
import { Address } from "@alto/types"
import { createClient, http } from "viem"

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
    const handlerConfig: RpcHandlerConfig = await bundlerArgsToRpcHandlerConfig(parsedArgs)
    const client = handlerConfig.publicClient
    const addressToValidator = new Map<Address, IValidator>()
    const mempool = new MemoryMempool(client)
    parsedArgs.entryPoints.forEach((entryPoint: Address) => {
        addressToValidator.set(entryPoint, new EmptyValidator(handlerConfig.publicClient, entryPoint, mempool))
    })
    const rpcEndpoint = new RpcHandler(handlerConfig, addressToValidator)

    const server = new Server(rpcEndpoint, parsedArgs)
    await server.start()
}
