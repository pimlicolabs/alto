import { createMethodHandler } from "../types"
import { pimlicoGetUserOperationStatusSchema } from "@alto/types"

export const pimlicoGetUserOperationStatusHandler = createMethodHandler({
    method: "pimlico_getUserOperationStatus",
    schema: pimlicoGetUserOperationStatusSchema,
    handler: async ({ relay, params }) => {
        const [userOperationHash] = params
        return relay.monitor.getUserOperationStatus(userOperationHash)
    }
})
