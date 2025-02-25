import { createMethodHandler } from "../types"
import { bundlerSetReputationsSchema } from "@alto/types"

export const bundlerSetReputationHandler = createMethodHandler({
    schema: bundlerSetReputationsSchema,
    handler: async ({ relay, params }) => {
        const [args, address] = params
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_setReputation")
        relay.reputationManager.setReputation(address, args)

        return "ok" as const
    }
})
