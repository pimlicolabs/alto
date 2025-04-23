import { getUserOperationHash } from "../../utils/userop"
import { createMethodHandler } from "../createMethodHandler"
import {
    sendUserOperationSchema,
    RpcError,
    ValidationErrors,
    type UserOperation,
    type Address,
    type ApiVersion
} from "@alto/types"
import { calcPreVerificationGas, getAAError } from "@alto/utils"
import { RpcHandler } from "../rpcHandler"

export async function addToMempoolIfValid(
    rpcHandler: RpcHandler,
    userOperation: UserOperation,
    entryPoint: Address,
    apiVersion: ApiVersion
): Promise<"added" | "queued"> {
    rpcHandler.ensureEntryPointIsSupported(entryPoint)

    // V1 api doesn't check prefund.
    const shouldCheckPrefund =
        apiVersion !== "v1" && rpcHandler.config.shouldCheckPrefund

    const userOpHash = await getUserOperationHash({
        userOperation: userOperation,
        entryPointAddress: entryPoint,
        chainId: rpcHandler.config.chainId,
        publicClient: rpcHandler.config.publicClient
    })
    const validationResult = await rpcHandler.validator.validateUserOperation({
        shouldCheckPrefund,
        userOperation,
        queuedUserOperations: [],
        entryPoint
    })

    const preMempoolChecks = await rpcHandler.preMempoolChecks(
        userOperation,
        apiVersion
    )

    if (!preMempoolChecks.valid) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            preMempoolChecks.reason
        )
        throw new RpcError(preMempoolChecks.reason)
    }

    // Nonce validation
    const { userOperationNonceValue, currentNonceValue, queuedUserOperations } =
        await rpcHandler.getNonceValues(userOperation, entryPoint)

    if (userOperationNonceValue < currentNonceValue) {
        const reason =
            "UserOperation failed validation with reason: AA25 invalid account nonce"
        rpcHandler.eventManager.emitFailedValidation(userOpHash, reason, "AA25")
        throw new RpcError(reason, ValidationErrors.InvalidFields)
    }

    if (userOperationNonceValue > currentNonceValue + 10n) {
        const reason =
            "UserOperation failed validaiton with reason: AA25 invalid account nonce"
        rpcHandler.eventManager.emitFailedValidation(userOpHash, reason, "AA25")
        throw new RpcError(reason, ValidationErrors.InvalidFields)
    }

    if (
        userOperationNonceValue >
        currentNonceValue + BigInt(queuedUserOperations.length)
    ) {
        rpcHandler.mempool.add(userOperation, entryPoint)
        rpcHandler.eventManager.emitQueued(userOpHash)
        return "queued"
    }

    // userOp validation
    if (rpcHandler.config.dangerousSkipUserOperationValidation) {
        const [success, errorReason] = await rpcHandler.mempool.add(
            userOperation,
            entryPoint
        )
        if (!success) {
            rpcHandler.eventManager.emitFailedValidation(
                userOpHash,
                errorReason,
                getAAError(errorReason)
            )
            throw new RpcError(errorReason, ValidationErrors.InvalidFields)
        }
        return "added"
    }

    // PVG validation
    if (apiVersion !== "v1") {
        const requiredPvg = await calcPreVerificationGas({
            config: rpcHandler.config,
            userOperation,
            entryPoint,
            gasPriceManager: rpcHandler.gasPriceManager,
            validate: true
        })

        if (requiredPvg > userOperation.preVerificationGas) {
            throw new RpcError(
                `preVerificationGas is not enough, required: ${requiredPvg}, got: ${userOperation.preVerificationGas}`,
                ValidationErrors.SimulateValidation
            )
        }
    }

    rpcHandler.reputationManager.checkReputation(
        userOperation,
        entryPoint,
        validationResult
    )

    await rpcHandler.mempool.checkEntityMultipleRoleViolation(
        entryPoint,
        userOperation
    )

    const [success, errorReason] = await rpcHandler.mempool.add(
        userOperation,
        entryPoint,
        validationResult.referencedContracts
    )

    if (!success) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            errorReason,
            getAAError(errorReason)
        )
        throw new RpcError(errorReason, ValidationErrors.InvalidFields)
    }
    return "added"
}

export const ethSendUserOperationHandler = createMethodHandler({
    method: "eth_sendUserOperation",
    schema: sendUserOperationSchema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        const [userOperation, entryPoint] = params

        if (userOperation.eip7702Auth) {
            await rpcHandler.validateEip7702Auth({
                userOperation,
                validateSender: true
            })
        }

        const hash = await getUserOperationHash({
            userOperation,
            entryPointAddress: entryPoint,
            chainId: rpcHandler.config.chainId,
            publicClient: rpcHandler.config.publicClient
        })

        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            status = await addToMempoolIfValid(
                rpcHandler,
                userOperation,
                entryPoint,
                apiVersion
            )

            await rpcHandler.eventManager.emitReceived(hash)

            return hash
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
