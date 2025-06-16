import { createMethodHandler } from "../createMethodHandler"
import { debugGetStakeStatusSchema, RpcError } from "@alto/types"

export const debugGetStakeStatusHandler = createMethodHandler({
    schema: debugGetStakeStatusSchema,
    method: "debug_bundler_getStakeStatus",
    // @ts-ignore
    handler: async ({ rpcHandler, params }) => {
        const [address, entryPoint] = params
        rpcHandler.ensureDebugEndpointsAreEnabled(
            "debug_bundler_getStakeStatus"
        )
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        const stakeStatus = await rpcHandler.reputationManager.getStakeStatus(
            entryPoint,
            address
        )

        const response = debugGetStakeStatusSchema.shape.result.safeParse({
            isStaked: stakeStatus.isStaked,
            stakeInfo: stakeStatus.stakeInfo
        })

        if (!response.success) {
            throw new RpcError("Internal error: response validation failed")
        }

        return response.data
    }
})
