import { debugClearReputationSchema } from "@alto/schemas"
import { createMethodHandler } from "../createMethodHandler"

export const debugClearReputationHandler = createMethodHandler({
    schema: debugClearReputationSchema,
    method: "debug_bundler_clearReputation",
    handler: ({ rpcHandler }) => {
        rpcHandler.ensureDebugEndpointsAreEnabled(
            "debug_bundler_clearReputation"
        )
        rpcHandler.reputationManager.clear()

        return Promise.resolve("ok" as const)
    }
})
