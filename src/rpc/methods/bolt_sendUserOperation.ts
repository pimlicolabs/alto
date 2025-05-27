import { boltSendUserOperationSchema } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"
import { addToMempoolIfValid } from "./eth_sendUserOperation"

export const boltSendUserOperationHandler = createMethodHandler({
    method: "bolt_sendUserOperation",
    schema: boltSendUserOperationSchema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        const [userOperation, entryPoint] = params

        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            const { result, userOpHash } = await addToMempoolIfValid({
                rpcHandler,
                userOperation,
                entryPoint,
                apiVersion
            })

            status = result

            rpcHandler.eventManager.emitReceived(userOpHash)

            return userOpHash
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
