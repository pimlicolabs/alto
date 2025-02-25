import { createMethodHandler } from "../createMethodHandler"
import { supportedEntryPointsSchema } from "@alto/types"

export const ethSupportedEntryPointsHandler = createMethodHandler({
    method: "eth_supportedEntryPoints",
    schema: supportedEntryPointsSchema,
    handler: ({ rpcHandler }) => {
        return rpcHandler.config.entrypoints
    }
})
