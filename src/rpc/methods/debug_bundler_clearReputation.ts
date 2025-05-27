import { debugClearReputationSchema } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"

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
