import { createMethodHandler } from "../types"
import { estimateUserOperationGasSchema } from "@alto/types"

export const ethEstimateUserOperationGasHandler = createMethodHandler({
    method: "eth_estimateUserOperationGas",
    schema: estimateUserOperationGasSchema,
    handler: async ({ rpcHandler, apiVersion, params }) => {
        const userOperation = params[0]
        const entryPoint = params[1]
        const stateOverrides = params[2]

        return await rpcHandler.estimateGas({
            apiVersion,
            userOperation,
            entryPoint,
            stateOverrides
        })
    }
})
