import { createMethodHandler } from "../types"
import { getUserOperationReceiptSchema } from "@alto/types"

export const ethGetUserOperationReceiptHandler = createMethodHandler({
    method: "eth_getUserOperationReceipt",
    schema: getUserOperationReceiptSchema,
    handler: async ({ relay, params }) => {
        const [userOperationHash] = params
        return relay.executorManager.getUserOperationReceipt(userOperationHash)
    }
})
