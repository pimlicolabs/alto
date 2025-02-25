import { createMethodHandler } from "../types"
import { debugClearReputationSchema } from "@alto/types"

export const debugClearReputationHandler = createMethodHandler({
    schema: debugClearReputationSchema,
    method: "debug_bundler_clearReputation",
    handler: async ({ relay }) => {
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_clearReputation")
        relay.reputationManager.clear()

        return "ok" as const
    }
})
