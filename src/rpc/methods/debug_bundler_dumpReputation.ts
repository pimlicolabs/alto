import { createMethodHandler } from "../createMethodHandler"
import { debugDumpReputationSchema } from "@alto/types"

export const debugBundlerDumpReputationHandler = createMethodHandler({
    schema: debugDumpReputationSchema,
    method: "debug_bundler_dumpReputation",
    handler: ({ rpcHandler, params }) => {
        const [entryPoint] = params
        rpcHandler.ensureDebugEndpointsAreEnabled("debug_bundler_setReputation")
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        return Promise.all(
            rpcHandler.reputationManager.dumpReputations(entryPoint)
        )
    }
})
