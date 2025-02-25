import { createMethodHandler } from "../types"
import { pimlicoGetUserOperationStatusSchema } from "@alto/types"

export const pimlicoGetUserOperationStatusHandler = createMethodHandler({
    method: "pimlico_getUserOperationStatus",
    schema: pimlicoGetUserOperationStatusSchema,
    handler: async ({ rpcHandler, params }) => {
        const [userOperationHash] = params
        return rpcHandler.monitor.getUserOperationStatus(userOperationHash)
    }
})
