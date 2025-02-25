import { createMethodHandler } from "../types"
import { pimlicoExperimentalEstimateUserOperationGas7702Schema } from "@alto/types"

export const experimentalEstimateUserOperationGas7702Handler =
    createMethodHandler({
        method: "pimlico_experimental_estimateUserOperationGas7702",
        schema: pimlicoExperimentalEstimateUserOperationGas7702Schema,
        handler: async ({ apiVersion, relay, params }) => {
            rpcHandler.ensureExperimentalEndpointsAreEnabled(
                "pimlico_experimental_estimateUserOperationGas7702"
            )

            const userOperation = params[0]
            const entryPoint = params[1]
            const stateOverrides = params[2]

            await rpcHandler.validateEip7702Auth(userOperation)

            return await rpcHandler.estimateGas({
                apiVersion,
                userOperation,
                entryPoint,
                stateOverrides
            })
        }
    })
