import { createMethodHandler } from "../createMethodHandler"
import { RpcError, getUserOperationReceiptSchema } from "@alto/types"

export const ethGetUserOperationReceiptHandler = createMethodHandler({
    method: "eth_getUserOperationReceipt",
    schema: getUserOperationReceiptSchema,
    handler: async ({ rpcHandler, params }) => {
        const [userOperationHash] = params
        try {
            return await rpcHandler.executorManager.getUserOperationReceipt(
                userOperationHash
            )
        } catch (err) {
            rpcHandler.logger.error(
                { err, userOperationHash },
                "Unexpected error while getting user operation receipt"
            )
            throw new RpcError("Failed to get user operation receipt")
        }
    }
})
