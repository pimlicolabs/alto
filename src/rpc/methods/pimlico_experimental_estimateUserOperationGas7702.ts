import { createMethodHandler } from "../types"
import { pimlicoExperimentalEstimateUserOperationGas7702Schema } from "@alto/types"

export const experimentalEstimateUserOperationGas7702Handler =
    createMethodHandler({
        schema: pimlicoExperimentalEstimateUserOperationGas7702Schema,
        handler: async ({ meta, relay, params }) => {
            relay.ensureExperimentalEndpointsAreEnabled(
                "pimlico_experimental_estimateUserOperationGas7702"
            )

            const userOperation = params[0]
            const entryPoint = params[1]
            const stateOverrides = params[2]

            const { apiVersion } = meta

            await relay.validateEip7702Auth(userOperation)

            return await relay.estimateGas({
                apiVersion,
                userOperation,
                entryPoint,
                stateOverrides
            })
        }
    })
