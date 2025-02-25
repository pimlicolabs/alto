import { createMethodHandler } from "../createMethodHandler"
import { debugSetReputationSchema } from "@alto/types"

export const debugSetReputationHandler = createMethodHandler({
    method: "debug_bundler_setReputation",
    schema: debugSetReputationSchema,
    handler: ({ rpcHandler, params }) => {
        const [args, address] = params
        rpcHandler.ensureDebugEndpointsAreEnabled("debug_bundler_setReputation")
        rpcHandler.reputationManager.setReputation(address, args)

        return "ok" as const
    }
})
