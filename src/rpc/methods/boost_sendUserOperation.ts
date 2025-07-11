import { RpcError } from "@alto/types"
import { isVersion06, isVersion07 } from "@alto/utils"
import {
    type UserOperation,
    boostSendUserOperationSchema
} from "../../types/schemas"
import { createMethodHandler } from "../createMethodHandler"
import { addToMempoolIfValid } from "./eth_sendUserOperation"

const validateUserOp = ({ userOp }: { userOp: UserOperation }) => {
    if (userOp.maxFeePerGas !== 0n || userOp.maxPriorityFeePerGas !== 0n) {
        throw new RpcError(
            "maxFeePerGas and maxPriorityFeePerGas must be 0 for a boosted user operation"
        )
    }

    if (isVersion06(userOp)) {
        if (userOp.paymasterAndData !== "0x") {
            throw new RpcError(
                "Paymaster is not supported for boosted user operations. paymasterAndData must be '0x'"
            )
        }
    }

    if (isVersion07(userOp)) {
        if (
            userOp.paymaster ||
            userOp.paymasterData ||
            userOp.paymasterPostOpGasLimit ||
            userOp.paymasterVerificationGasLimit
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
        const [userOp, entryPoint] = params

        validateUserOp({ userOp })

        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            const { result, userOpHash } = await addToMempoolIfValid({
                rpcHandler,
                userOp,
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
            rpcHandler.metrics.userOpsReceived
                .labels({
                    status,
                    type: userOp.eip7702Auth ? "7702" : "boost"
                })
                .inc()
        }
    }
})
