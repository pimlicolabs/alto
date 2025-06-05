import {
    boostSendUserOperationSchema,
    type UserOperation
} from "../../types/schemas"
import { createMethodHandler } from "../createMethodHandler"
import { addToMempoolIfValid } from "./eth_sendUserOperation"
import { RpcError } from "@alto/types"

const validateUserOperation = ({
    userOperation
}: { userOperation: UserOperation }) => {
    if (
        userOperation.maxFeePerGas !== 0n ||
        userOperation.maxPriorityFeePerGas !== 0n
    ) {
        throw new RpcError(
            "maxFeePerGas and maxPriorityFeePerGas must be 0 for a boosted user operation"
        )
    }
}

export const boostSendUserOperationHandler = createMethodHandler({
    method: "boost_sendUserOperation",
    schema: boostSendUserOperationSchema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        const [userOperation, entryPoint] = params

        validateUserOperation({ userOperation })

        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            const { result, userOpHash } = await addToMempoolIfValid(
                rpcHandler,
                userOperation,
                entryPoint,
                apiVersion,
                true
            )

            status = result

            rpcHandler.eventManager.emitReceived(userOpHash)

            return userOpHash
        } catch (error) {
            status = "rejected"
            throw error
        } finally {
            rpcHandler.metrics.userOperationsReceived
                .labels({
                    status,
                    type: "regular"
                })
                .inc()
        }
    }
})
