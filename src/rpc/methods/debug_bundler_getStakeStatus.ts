import { createMethodHandler } from "../createMethodHandler"
import { debugGetStakeStatusSchema } from "@alto/types"

export const debugGetStakeStatusHandler = createMethodHandler({
    schema: debugGetStakeStatusSchema,
    method: "debug_bundler_getStakeStatus",
    // @ts-ignore
    handler: async ({ rpcHandler, params }) => {
        const [entryPoint, address] = params
        rpcHandler.ensureDebugEndpointsAreEnabled(
            "debug_bundler_getStakeStatus"
        )
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        await rpcHandler.reputationManager.getStakeStatus(entryPoint, address)
    }
})
