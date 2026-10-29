import {
    ERC7769Errors,
    RpcError,
    pimlicoSendPreparedUserOperationSchema
} from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"
import {
    createInstantSend,
    isBoostedUserOp,
    sendInstantBundle
} from "./pimlico_sendUserOperationNow"

// Sends a userOp from pimlico_prepareUserOperation like
// pimlico_sendUserOperationNow, with the simulation from the prepare.
export const pimlicoSendPreparedUserOperationHandler = createMethodHandler({
    method: "pimlico_sendPreparedUserOperation",
    schema: pimlicoSendPreparedUserOperationSchema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        if (!rpcHandler.config.enableInstantBundlingEndpoint) {
            throw new RpcError(
                "pimlico_sendPreparedUserOperation endpoint is not enabled",
                ERC7769Errors.InvalidFields
            )
        }

        const requestStart = Date.now()
        const [id] = params

        const prepared = rpcHandler.preparedUserOps.take(id)
        if (!prepared) {
            throw new RpcError(
                "prepared userOperation not found, it may have expired",
                ERC7769Errors.InvalidFields
            )
        }

        const { bundle, filterOpsResult } = prepared
        const [{ userOp }] = bundle.userOps

        return await sendInstantBundle({
            rpcHandler,
            bundle,
            filterOpsResult,
            requestStart,
            instantSend: createInstantSend({
                rpcHandler,
                userOp,
                entryPoint: bundle.entryPoint,
                apiVersion,
                isBoosted: isBoostedUserOp(userOp),
                requestStart
            })
        })
    }
})
