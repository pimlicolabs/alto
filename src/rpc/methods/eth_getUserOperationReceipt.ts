import { RpcError } from "@alto/types"
import { getUserOperationReceiptRequestSchema } from "@alto/schemas"
import { createMethodHandler } from "../createMethodHandler"

export const ethGetUserOperationReceiptHandler = createMethodHandler({
    method: "eth_getUserOperationReceipt",
    schema: getUserOperationReceiptRequestSchema,
    handler: async ({ rpcHandler, params }) => {
        const [userOpHash] = params
        try {
            return await rpcHandler.userOpMonitor.getUserOpReceipt(userOpHash)
        } catch (err) {
            rpcHandler.logger.error(
                { err, userOpHash },
                "Unexpected error while getting user operation receipt"
            )
            throw new RpcError("Failed to get user operation receipt")
        }
    }
})
