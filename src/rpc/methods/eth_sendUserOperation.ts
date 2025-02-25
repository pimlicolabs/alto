import { getUserOperationHash } from "../../utils/userop"
import { createMethodHandler } from "../types"
import { sendUserOperationSchema } from "@alto/types"

export const ethSendUserOperationHandler = createMethodHandler({
    method: "eth_sendUserOperation",
    schema: sendUserOperationSchema,
    handler: async ({ relay, params, apiVersion }) => {
        const [userOperation, entryPoint] = params

        const hash = getUserOperationHash(
            userOperation,
            entryPoint,
            relay.config.publicClient.chain.id
        )
        relay.eventManager.emitReceived(hash)

        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            status = await relay.addToMempoolIfValid(
                userOperation,
                entryPoint,
                apiVersion
            )

            return hash
        } catch (error) {
            status = "rejected"
            throw error
        } finally {
            relay.metrics.userOperationsReceived
                .labels({
                    status,
                    type: "regular"
                })
                .inc()
        }
    }
})
