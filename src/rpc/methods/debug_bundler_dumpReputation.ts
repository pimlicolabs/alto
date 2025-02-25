import { createMethodHandler } from "../types"
import { debugDumpReputationSchema } from "@alto/types"

export const debugBundlerDumpReputationHandler = createMethodHandler({
    schema: debugDumpReputationSchema,
    method: "debug_bundler_dumpReputation",
    handler: async ({ relay, params }) => {
        const [entryPoint] = params
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_setReputation")
        relay.ensureEntryPointIsSupported(entryPoint)

        return relay.reputationManager.dumpReputations(entryPoint)
    }
})
