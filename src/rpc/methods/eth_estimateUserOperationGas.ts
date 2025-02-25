import { createMethodHandler } from "../types"
import { estimateUserOperationGasSchema } from "@alto/types"

export const ethEstimateUserOperationGasHandler = createMethodHandler({
    schema: estimateUserOperationGasSchema,
    handler: async ({ relay, meta, params }) => {
        const userOperation = params[0]
        const entryPoint = params[1]
        const stateOverrides = params[2]
        const { apiVersion } = meta

        return await relay.estimateGas({
            apiVersion,
            userOperation,
            entryPoint,
            stateOverrides
        })
    }
})
