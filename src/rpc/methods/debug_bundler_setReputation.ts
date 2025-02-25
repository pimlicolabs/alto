import { createMethodHandler } from "../types"
import { debugSetReputationSchema } from "@alto/types"

export const debugSetReputationHandler = createMethodHandler({
    method: "debug_bundler_setReputation",
    schema: debugSetReputationSchema,
    handler: async ({ relay, params }) => {
        const [args, address] = params
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_setReputation")
        relay.reputationManager.setReputation(address, args)

        return "ok" as const
    }
})
