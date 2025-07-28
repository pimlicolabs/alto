import { supportedEntryPointsRequestSchema } from "@alto/schemas"
import { createMethodHandler } from "../createMethodHandler"

export const ethSupportedEntryPointsHandler = createMethodHandler({
    method: "eth_supportedEntryPoints",
    schema: supportedEntryPointsRequestSchema,
    handler: ({ rpcHandler }) => {
        return rpcHandler.config.entrypoints
    }
})
