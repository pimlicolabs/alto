import { createMethodHandler } from "../types"
import { bundlerClearReputationSchema } from "@alto/types"

export const bundlerClearReputationHandler = createMethodHandler({
    method: "debug_bundler_clearReputation",
    schema: bundlerClearReputationSchema.shape.params,
    responseSchema: bundlerClearReputationSchema.shape.result,
    handler: async ({ relay }) => {
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_clearReputation")
        relay.reputationManager.clear()

        return "ok" as const
    }
})
