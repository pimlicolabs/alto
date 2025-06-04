import {
    getAddressFromInitCodeOrPaymasterAndData,
    isVersion06
} from "@alto/utils"
import {
    boostSendUserOperationSchema,
    type UserOperation
} from "../../types/schemas"
import { createMethodHandler } from "../createMethodHandler"
import { addToMempoolIfValid } from "./eth_sendUserOperation"
import { RpcError } from "@alto/types"
import type { AltoConfig } from "../../createConfig"

const validateUserOperation = ({
    userOperation,
    config
}: { userOperation: UserOperation; config: AltoConfig }) => {
    if (!config.boostUserOperationPaymasterAddress) {
        throw new RpcError("boosted user operation is not enabled")
    }

    if (
        userOperation.maxFeePerGas !== 0n ||
        userOperation.maxPriorityFeePerGas !== 0n
    ) {
        throw new RpcError(
            "maxFeePerGas and maxPriorityFeePerGas must be 0 for a boosted user operation"
        )
    }

    const paymaster = isVersion06(userOperation)
        ? getAddressFromInitCodeOrPaymasterAndData(
              userOperation.paymasterAndData
          )
        : userOperation.paymaster

    if (paymaster !== config.boostUserOperationPaymasterAddress) {
        throw new RpcError(
            `paymaster address must be ${config.boostUserOperationPaymasterAddress} for a boosted user operation`
        )
    }
}

export const boostSendUserOperationHandler = createMethodHandler({
    method: "boost_sendUserOperation",
    schema: boostSendUserOperationSchema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        const [userOperation, entryPoint] = params

        validateUserOperation({ userOperation, config: rpcHandler.config })

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
