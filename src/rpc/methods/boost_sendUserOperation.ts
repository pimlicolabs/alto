import { isVersion06, isVersion07 } from "@alto/utils"
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

    if (isVersion06(userOperation)) {
        if (userOperation.paymasterAndData !== "0x") {
            throw new RpcError(
                "Paymaster is not supported for boosted user operations. paymasterAndData must be '0x'"
            )
        }
    }

    if (isVersion07(userOperation)) {
        if (
            userOperation.paymaster ||
            userOperation.paymasterData ||
            userOperation.paymasterPostOpGasLimit ||
            userOperation.paymasterVerificationGasLimit
        ) {
            throw new RpcError(
                "Paymaster is not supported for boosted user operations. All paymaster fields must be empty"
            )
        }
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
            const { result, userOpHash } = await addToMempoolIfValid({
                rpcHandler,
                userOperation,
                entryPoint,
                apiVersion,
                boost: true
            })

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
                    type: !!userOperation.eip7702Auth ? "7702" : "boost"
                })
                .inc()
        }
    }
})
