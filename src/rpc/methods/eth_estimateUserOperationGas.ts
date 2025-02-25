import { createMethodHandler } from "../createMethodHandler"
import { estimateUserOperationGasSchema } from "@alto/types"

export const ethEstimateUserOperationGasHandler = createMethodHandler({
    method: "eth_estimateUserOperationGas",
    schema: estimateUserOperationGasSchema,
    handler: ({ rpcHandler, apiVersion, params }) => {
        const userOperation = params[0]
        const entryPoint = params[1]
        const stateOverrides = params[2]

        return rpcHandler.estimateGas({
            apiVersion,
            userOperation,
            entryPoint,
            stateOverrides
        })
    }
})
