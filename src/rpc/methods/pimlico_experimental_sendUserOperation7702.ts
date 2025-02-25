import { getUserOperationHash } from "@alto/utils"
import { createMethodHandler } from "../types"
import { pimlicoExperimentalSendUserOperation7702Schema } from "@alto/types"

export const pimlicoExperimentalSendUserOperation7702Handler =
    createMethodHandler({
        method: "pimlico_experimental_sendUserOperation7702",
        schema: pimlicoExperimentalSendUserOperation7702Schema.shape.params,
        responseSchema:
            pimlicoExperimentalSendUserOperation7702Schema.shape.result,
        handler: async ({ relay, params, meta }) => {
            relay.ensureExperimentalEndpointsAreEnabled(
                "pimlico_experimental_sendUserOperation7702"
            )

            const [userOperation, entryPoint] = params
            const { apiVersion } = meta

            relay.ensureEntryPointIsSupported(entryPoint)
            await relay.validateEip7702Auth(userOperation)

            await relay.addToMempoolIfValid(
                userOperation,
                entryPoint,
                apiVersion
            )

            return getUserOperationHash(
                userOperation,
                entryPoint,
                relay.config.publicClient.chain.id
            )
        }
    })
