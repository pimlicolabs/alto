import { createMethodHandler } from "../createMethodHandler"
import { getUserOperationReceiptSchema } from "@alto/types"

export const ethGetUserOperationReceiptHandler = createMethodHandler({
    method: "eth_getUserOperationReceipt",
    schema: getUserOperationReceiptSchema,
    handler: ({ rpcHandler, params }) => {
        const [userOperationHash] = params
        return rpcHandler.executorManager.getUserOperationReceipt(
            userOperationHash
        )
    }
})
