import { createMethodHandler } from "../types"
import { pimlicoExperimentalEstimateUserOperationGas7702Schema } from "@alto/types"

export const ethChainIdHandler = createMethodHandler({
    method: "pimlico_experimental_estimateUserOperationGas7702",
    schema: pimlicoExperimentalEstimateUserOperationGas7702Schema.shape.params,
    responseSchema:
        pimlicoExperimentalEstimateUserOperationGas7702Schema.shape.result,
    handler: async ({ meta, relay, params }) => {
        relay.ensureExperimentalEndpointsAreEnabled(
            "pimlico_experimental_estimateUserOperationGas7702"
        )

        const [userOperation, entryPoint, stateOverrides] = params
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
