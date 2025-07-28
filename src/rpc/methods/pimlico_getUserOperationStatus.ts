import { pimlicoGetUserOperationStatusRequestSchema } from "@alto/schemas"
import { createMethodHandler } from "../createMethodHandler"

export const pimlicoGetUserOperationStatusHandler = createMethodHandler({
    method: "pimlico_getUserOperationStatus",
    schema: pimlicoGetUserOperationStatusRequestSchema,
    handler: ({ rpcHandler, params }) => {
        const [userOpHash] = params
        return rpcHandler.monitor.getUserOpStatus(userOpHash)
    }
})
