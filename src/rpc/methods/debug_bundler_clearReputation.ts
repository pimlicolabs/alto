import { createMethodHandler } from "../types"
import { bundlerClearReputationSchema } from "@alto/types"

export const bundlerClearReputationHandler = createMethodHandler({
    schema: bundlerClearReputationSchema,
    handler: async ({ relay }) => {
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_clearReputation")
        relay.reputationManager.clear()

        return "ok" as const
    }
})
