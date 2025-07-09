import { createMethodHandler } from "../createMethodHandler"
import { debugClearStateSchema } from "@alto/types"

export const debugBundlerClearStateHandler = createMethodHandler({
    schema: debugClearStateSchema,
    method: "debug_bundler_clearState",
    handler: ({ rpcHandler }) => {
        rpcHandler.ensureDebugEndpointsAreEnabled("debug_bundler_clearState")
        rpcHandler.mempool.clear()
        rpcHandler.reputationManager.clearEntityCount()

        return Promise.resolve("ok" as const)
    }
})
