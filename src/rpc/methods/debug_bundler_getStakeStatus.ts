import { createMethodHandler } from "../types"
import { bundlerGetStakeStatusSchema } from "@alto/types"

export const debugGetStakeStatusHandler = createMethodHandler({
    schema: bundlerGetStakeStatusSchema,
    // @ts-ignore
    handler: async ({ relay, params }) => {
        const [entryPoint, address] = params
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_getStakeStatus")
        relay.ensureEntryPointIsSupported(entryPoint)

        await relay.reputationManager.getStakeStatus(entryPoint, address)
    }
})
