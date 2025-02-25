import { createMethodHandler } from "../types"
import { bundlerSetBundlingModeSchema } from "@alto/types"

export const debugBundlerSetBundlingModeHandler = createMethodHandler({
    schema: bundlerSetBundlingModeSchema,
    handler: async ({ relay, params }) => {
        const [bundlingMode] = params
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_setBundlingMode")
        await relay.executorManager.setBundlingMode(bundlingMode)

        return "ok" as const
    }
})
