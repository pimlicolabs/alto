import { createMethodHandler } from "../types"
import { supportedEntryPointsSchema } from "@alto/types"

export const ethSupportedEntryPointsHandler = createMethodHandler({
    method: "eth_supportedEntryPoints",
    schema: supportedEntryPointsSchema.shape.params,
    responseSchema: supportedEntryPointsSchema.shape.result,
    handler: ({ meta }) => {
        return meta.config.entrypoints
    }
})
