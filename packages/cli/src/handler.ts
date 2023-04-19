import { fromZodError } from "zod-validation-error"
import { IBundlerArgs, IBundlerArgsInput, bundlerArgsSchema } from "@alto/config"
import { RpcHandler, Server } from "@alto/api"
import { EmptyValidator } from "@alto/validator"
import { createPublicClient, http } from "viem"
import { MemoryMempool } from "@alto/mempool"
import { Address } from "@alto/types"

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
    const client = createPublicClient(
        {
            transport: http(args.rpcUrl),
        }
    )
    const addressToValidator = new Map()
    const mempool = new MemoryMempool(client)
    parsedArgs.entryPoints.forEach((addr : Address) => {
        addressToValidator.set(addr, new EmptyValidator(
            client,
            addr,
            mempool
        ))
    });
    const rpcEndpoint = new RpcHandler(client, addressToValidator)

    const server = new Server(rpcEndpoint, parsedArgs)
    await server.start()
}
