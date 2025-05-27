import { pimlicoGetUserOperationStatusSchema } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"

export const pimlicoGetUserOperationStatusHandler = createMethodHandler({
    method: "pimlico_getUserOperationStatus",
    schema: pimlicoGetUserOperationStatusSchema,
    handler: ({ rpcHandler, params }) => {
        const [userOperationHash] = params
        return rpcHandler.monitor.getUserOperationStatus(userOperationHash)
    }
})
