import { RpcError, getUserOperationReceiptSchema } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"

export const ethGetUserOperationReceiptHandler = createMethodHandler({
    method: "eth_getUserOperationReceipt",
    schema: getUserOperationReceiptSchema,
    handler: async ({ rpcHandler, params }) => {
        const [userOpHash] = params
        try {
            return await rpcHandler.bundleManager.getUserOpReceipt(userOpHash)
        } catch (err) {
            rpcHandler.logger.error(
                { err, userOpHash },
                "Unexpected error while getting user operation receipt"
            )
            throw new RpcError("Failed to get user operation receipt")
        }
    }
})
