import { createMethodHandler } from "../types"
import { bundlerDumpReputationsSchema } from "@alto/types"

export const debugBundlerDumpReputationHandler = createMethodHandler({
    schema: bundlerDumpReputationsSchema,
    handler: async ({ relay, params }) => {
        const [entryPoint] = params
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_setReputation")
        relay.ensureEntryPointIsSupported(entryPoint)

        return relay.reputationManager.dumpReputations(entryPoint)
    }
})
