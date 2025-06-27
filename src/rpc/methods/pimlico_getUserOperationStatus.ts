import { createMethodHandler } from "../createMethodHandler"
import { pimlicoGetUserOperationStatusSchema } from "@alto/types"

export const pimlicoGetUserOperationStatusHandler = createMethodHandler({
    method: "pimlico_getUserOperationStatus",
    schema: pimlicoGetUserOperationStatusSchema,
    handler: ({ rpcHandler, params }) => {
        const [userOpHash] = params
        return rpcHandler.monitor.getUserOpStatus(userOpHash)
    }
})
