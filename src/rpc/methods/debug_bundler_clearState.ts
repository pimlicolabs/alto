import { createMethodHandler } from "../types"
import { bundlerClearStateSchema } from "@alto/types"

export const debugBundlerClearStateHandler = createMethodHandler({
    schema: bundlerClearStateSchema,
    handler: async ({ relay }) => {
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_clearState")
        relay.mempool.clear()
        relay.reputationManager.clearEntityCount()

        return "ok" as const
    }
})
