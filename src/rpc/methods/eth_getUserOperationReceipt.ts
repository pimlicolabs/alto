import { createMethodHandler } from "../types"
import { getUserOperationReceiptSchema } from "@alto/types"

export const ethGetUserOperationReceiptHandler = createMethodHandler({
    schema: getUserOperationReceiptSchema,
    handler: async ({ relay, params }) => {
        const [userOperationHash] = params
        return relay.executorManager.getUserOperationReceipt(userOperationHash)
    }
})
