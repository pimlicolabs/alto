import { createMethodHandler } from "../types"
import { debugClearStateSchema } from "@alto/types"

export const debugBundlerClearStateHandler = createMethodHandler({
    schema: debugClearStateSchema,
    method: "debug_bundler_clearState",
    handler: async ({ relay }) => {
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_clearState")
        relay.mempool.clear()
        relay.reputationManager.clearEntityCount()

        return "ok" as const
    }
})
