import { RpcError } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"
import { debugGetStakeStatusRequestSchema } from "@alto/schemas"

export const debugGetStakeStatusHandler = createMethodHandler({
    schema: debugGetStakeStatusRequestSchema,
    method: "debug_bundler_getStakeStatus",
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

        const response =
            debugGetStakeStatusRequestSchema.shape.result.safeParse({
                isStaked: stakeStatus.isStaked,
                stakeInfo: stakeStatus.stakeInfo
            })

        if (!response.success) {
            throw new RpcError("Internal error: response validation failed")
        }

        return response.data
    }
})
