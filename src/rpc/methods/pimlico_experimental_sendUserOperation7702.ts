import { getUserOperationHash } from "@alto/utils"
import { createMethodHandler } from "../createMethodHandler"
import { pimlicoExperimentalSendUserOperation7702Schema } from "@alto/types"

export const experimentalSendUserOperation7702Handler = createMethodHandler({
    method: "pimlico_experimental_sendUserOperation7702",
    schema: pimlicoExperimentalSendUserOperation7702Schema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        rpcHandler.ensureExperimentalEndpointsAreEnabled(
            "pimlico_experimental_sendUserOperation7702"
        )

        const [userOperation, entryPoint] = params

        rpcHandler.ensureEntryPointIsSupported(entryPoint)
        await rpcHandler.validateEip7702Auth(userOperation)

        await rpcHandler.addToMempoolIfValid(
            userOperation,
            entryPoint,
            apiVersion
        )

        return getUserOperationHash(
            userOperation,
            entryPoint,
            rpcHandler.config.publicClient.chain.id
        )
    }
})
