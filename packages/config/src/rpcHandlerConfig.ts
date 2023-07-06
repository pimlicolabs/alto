import { IBundlerArgs } from "./bundler"
import { Address } from "@alto/types"
import { PublicClient, createPublicClient, http } from "viem"

export type RpcHandlerConfig = {
    publicClient: PublicClient
    chainId: number
    entryPoint: Address
    usingTenderly: boolean
}

export const bundlerArgsToRpcHandlerConfig = async (args: IBundlerArgs): Promise<RpcHandlerConfig> => {
    const client = createPublicClient({
        transport: http(args.rpcUrl)
    })

    const chainId = await client.getChainId()

    return {
        publicClient: client,
        chainId,
        entryPoint: args.entryPoint,
        usingTenderly: args.tenderlyEnabled ?? false
    }
}
