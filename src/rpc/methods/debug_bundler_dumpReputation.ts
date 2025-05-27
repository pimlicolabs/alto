import { debugDumpReputationSchema } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"

export const debugBundlerDumpReputationHandler = createMethodHandler({
    schema: debugDumpReputationSchema,
    method: "debug_bundler_dumpReputation",
    handler: async ({ rpcHandler, params }) => {
        const [entryPoint] = params
        rpcHandler.ensureDebugEndpointsAreEnabled("debug_bundler_setReputation")
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        return rpcHandler.reputationManager.dumpReputations(entryPoint)
    }
})
