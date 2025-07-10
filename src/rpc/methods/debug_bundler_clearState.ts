import { debugClearStateSchema } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"

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
