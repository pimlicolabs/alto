import { supportedEntryPointsSchema } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"

export const ethSupportedEntryPointsHandler = createMethodHandler({
    method: "eth_supportedEntryPoints",
    schema: supportedEntryPointsSchema,
    handler: ({ rpcHandler }) => {
        return rpcHandler.config.entrypoints
    }
})
