import { RpcError } from "@alto/types"
import { isVersion06, isVersion07 } from "@alto/utils"
import {
    type UserOperation,
    boostSendUserOperationSchema
} from "../../types/schemas"
import { createMethodHandler } from "../createMethodHandler"
import { addToMempoolIfValid } from "./eth_sendUserOperation"

// Why the userOp can't be boosted (the bundler pays its gas), or undefined.
export const getBoostedUserOpError = ({
    userOp
}: {
    userOp: UserOperation
}): string | undefined => {
    if (userOp.maxFeePerGas !== 0n || userOp.maxPriorityFeePerGas !== 0n) {
        return "maxFeePerGas and maxPriorityFeePerGas must be 0 for a boosted user operation"
    }

    if (isVersion06(userOp)) {
        if (userOp.paymasterAndData !== "0x") {
            return "Paymaster is not supported for boosted user operations. paymasterAndData must be '0x'"
        }
    }

    if (isVersion07(userOp)) {
        if (
            userOp.paymaster ||
            userOp.paymasterData ||
            userOp.paymasterPostOpGasLimit ||
            userOp.paymasterVerificationGasLimit
        ) {
            return "Paymaster is not supported for boosted user operations. All paymaster fields must be empty"
        }
    }

    return undefined
}

export const boostSendUserOperationHandler = createMethodHandler({
    method: "boost_sendUserOperation",
    schema: boostSendUserOperationSchema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        const [userOp, entryPoint] = params

        const boostedUserOpError = getBoostedUserOpError({ userOp })
        if (boostedUserOpError) {
            throw new RpcError(boostedUserOpError)
        }

        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            const { result, userOpHash } = await addToMempoolIfValid({
                rpcHandler,
                userOp,
                entryPoint,
                apiVersion,
                isBoosted: true
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
