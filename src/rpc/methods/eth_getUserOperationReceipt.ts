import { createMethodHandler } from "../types"
import { getUserOperationReceiptSchema } from "@alto/types"

export const getUserOperationReceiptHandler = createMethodHandler({
    method: "eth_getUserOperationReceipt",
    schema: getUserOperationReceiptSchema.shape.params,
    responseSchema: getUserOperationReceiptSchema.shape.result,
    handler: async ({ relay, params }) => {
        const [userOperationHash] = params
        return relay.executorManager.getUserOperationReceipt(userOperationHash)
    }
})
