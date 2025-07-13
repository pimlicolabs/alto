import { debugDumpReputationSchema } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"

export const debugBundlerDumpReputationHandler = createMethodHandler({
    schema: debugDumpReputationSchema,
    method: "debug_bundler_dumpReputation",
    handler: ({ rpcHandler, params }) => {
        const [entryPoint] = params
        rpcHandler.ensureDebugEndpointsAreEnabled("debug_bundler_setReputation")
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        return Promise.resolve(
            rpcHandler.reputationManager.dumpReputations(entryPoint)
        )
    }
})
