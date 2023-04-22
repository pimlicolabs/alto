import { Address } from "@alto/types"
import { IBundlerArgs } from "./bundler"
import { PublicClient, createPublicClient, http } from "viem"

export type RpcHandlerConfig = {
    publicClient: PublicClient
    chainId: number
    entryPoint: Address
}

export const bundlerArgsToRpcHandlerConfig = async (args: IBundlerArgs): Promise<RpcHandlerConfig> => {
    const client = createPublicClient({
        transport: http(args.rpcUrl)
    })

    const chainId = await client.getChainId()

    return {
        publicClient: client,
        chainId,
        entryPoint: args.entryPoint
    }
}
