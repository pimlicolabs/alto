import { createMethodHandler } from "../types"
import { bundlerSetReputationsSchema } from "@alto/types"

export const bundlerSetReputationHandler = createMethodHandler({
    method: "debug_bundler_setReputation",
    schema: bundlerSetReputationsSchema.shape.params,
    responseSchema: bundlerSetReputationsSchema.shape.result,
    handler: async ({ relay, params }) => {
        const [args, address] = params
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_setReputation")
        relay.reputationManager.setReputation(address, args)

        return "ok" as const
    }
})
