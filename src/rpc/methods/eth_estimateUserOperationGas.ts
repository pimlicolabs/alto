import { createMethodHandler } from "../createMethodHandler"
import { estimateUserOperationGasSchema } from "@alto/types"

export const ethEstimateUserOperationGasHandler = createMethodHandler({
    method: "eth_estimateUserOperationGas",
    schema: estimateUserOperationGasSchema,
    handler: async ({ rpcHandler, apiVersion, params }) => {
        const userOperation = params[0]
        const entryPoint = params[1]
        const stateOverrides = params[2]

        if (userOperation.eip7702Auth) {
            await rpcHandler.validateEip7702Auth({
                userOperation
            })
        }

        return rpcHandler.estimateGas({
            apiVersion,
            userOperation,
            entryPoint,
            stateOverrides
        })
    }
})
