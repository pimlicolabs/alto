import { IBundlerArgs } from "./bundler"
import { Address } from "@alto/types"

export type RpcHandlerConfig = {
    entryPoint: Address
    usingTenderly: boolean
}

export const bundlerArgsToRpcHandlerConfig = async (args: IBundlerArgs): Promise<RpcHandlerConfig> => {
    return {
        entryPoint: args.entryPoint,
        usingTenderly: args.tenderlyEnabled ?? false
    }
}
