import { createMethodHandler } from "../createMethodHandler"
import { debugClearReputationSchema } from "@alto/types"

export const debugClearReputationHandler = createMethodHandler({
    schema: debugClearReputationSchema,
    method: "debug_bundler_clearReputation",
    handler: async ({ rpcHandler }) => {
        rpcHandler.ensureDebugEndpointsAreEnabled(
            "debug_bundler_clearReputation"
        )
        rpcHandler.reputationManager.clear()

        return "ok" as const
    }
})
