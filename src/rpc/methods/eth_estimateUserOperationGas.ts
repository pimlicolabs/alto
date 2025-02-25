import { createMethodHandler } from "../types"
import { estimateUserOperationGasSchema } from "@alto/types"

export const ethEstimateUserOperationGasHandler = createMethodHandler({
    method: "eth_estimateUserOperationGas",
    schema: estimateUserOperationGasSchema.shape.params,
    responseSchema: estimateUserOperationGasSchema.shape.result,
    handler: async ({ relay, meta, params }) => {
        const [userOperation, entryPoint, stateOverrides] = params
        const { apiVersion } = meta
        return await relay.estimateGas({
            apiVersion,
            userOperation,
            entryPoint,
            stateOverrides
        })
    }
})
