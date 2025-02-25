import { createMethodHandler } from "../types"
import { supportedEntryPointsSchema } from "@alto/types"

export const ethSupportedEntryPointsHandler = createMethodHandler({
    schema: supportedEntryPointsSchema,
    handler: ({ relay }) => {
        return relay.config.entrypoints
    }
})
