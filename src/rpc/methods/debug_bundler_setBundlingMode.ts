import { debugSetBundlingModeSchema } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"

export const debugBundlerSetBundlingModeHandler = createMethodHandler({
    method: "debug_bundler_setBundlingMode",
    schema: debugSetBundlingModeSchema,
    handler: async ({ rpcHandler, params }) => {
        const [bundlingMode] = params
        rpcHandler.ensureDebugEndpointsAreEnabled(
            "debug_bundler_setBundlingMode"
        )
        await rpcHandler.executorManager.setBundlingMode(bundlingMode)

        return "ok" as const
    }
})
