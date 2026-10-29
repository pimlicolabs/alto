import {
    ERC7769Errors,
    RpcError,
    pimlicoCancelPreparedUserOperationSchema
} from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"

// Drops a userOp from pimlico_prepareUserOperation. Returns false if it was
// already sent, cancelled or expired.
export const pimlicoCancelPreparedUserOperationHandler = createMethodHandler({
    method: "pimlico_cancelPreparedUserOperation",
    schema: pimlicoCancelPreparedUserOperationSchema,
    handler: async ({ rpcHandler, params }) => {
        if (!rpcHandler.config.enableInstantBundlingEndpoint) {
            throw new RpcError(
                "pimlico_cancelPreparedUserOperation endpoint is not enabled",
                ERC7769Errors.InvalidFields
            )
        }

        const [id] = params
        return await rpcHandler.preparedUserOps.release(id)
    }
})
