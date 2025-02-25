import { getUserOperationHash } from "../../utils/userop"
import { createMethodHandler } from "../createMethodHandler"
import { sendUserOperationSchema } from "@alto/types"

export const ethSendUserOperationHandler = createMethodHandler({
    method: "eth_sendUserOperation",
    schema: sendUserOperationSchema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        const [userOperation, entryPoint] = params

        const hash = getUserOperationHash(
            userOperation,
            entryPoint,
            rpcHandler.config.publicClient.chain.id
        )
        rpcHandler.eventManager.emitReceived(hash)

        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            status = await rpcHandler.addToMempoolIfValid(
                userOperation,
                entryPoint,
                apiVersion
            )

            return hash
        } catch (error) {
            status = "rejected"
            throw error
        } finally {
            rpcHandler.metrics.userOperationsReceived
                .labels({
                    status,
                    type: "regular"
                })
                .inc()
        }
    }
})
