import { createMethodHandler } from "../types"
import { bundlerSetBundlingModeSchema } from "@alto/types"

export const debugBundlerSetBundlingModeHandler = createMethodHandler({
    method: "debug_bundler_setBundlingMode",
    schema: bundlerSetBundlingModeSchema.shape.params,
    responseSchema: bundlerSetBundlingModeSchema.shape.result,
    handler: async ({ relay, params }) => {
        const [bundlingMode] = params
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_setBundlingMode")
        await relay.executorManager.setBundlingMode(bundlingMode)

        return "ok" as const
    }
})
