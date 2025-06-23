import {
    getNonceKeyAndSequence,
    getUserOperationHash
} from "../../utils/userop"
import { createMethodHandler } from "../createMethodHandler"
import {
    sendUserOperationSchema,
    RpcError,
    ValidationErrors,
    type UserOperation,
    type Address,
    type ApiVersion,
    ReferencedCodeHashes
} from "@alto/types"
import { calcPreVerificationGas, getAAError } from "@alto/utils"
import { RpcHandler } from "../rpcHandler"
import type * as validation from "@alto/types"
import { Hex } from "viem"

const validatePvg = async (
    apiVersion: ApiVersion,
    rpcHandler: RpcHandler,
    userOperation: UserOperation,
    entryPoint: Address,
    boost = false
): Promise<[boolean, string]> => {
    // PVG validation is skipped for v1
    if (apiVersion == "v1" || boost) {
        return [true, ""]
    }

    const requiredPvg = await calcPreVerificationGas({
        config: rpcHandler.config,
        userOperation,
        entryPoint,
        gasPriceManager: rpcHandler.gasPriceManager,
        validate: true
    })

    if (requiredPvg > userOperation.preVerificationGas) {
        return [
            false,
            `preVerificationGas is not enough, required: ${requiredPvg}, got: ${userOperation.preVerificationGas}`
        ]
    }

    return [true, ""]
}

const getUserOpValidationResult = async (
    rpcHandler: RpcHandler,
    userOperation: UserOperation,
    entryPoint: Address
): Promise<{
    queuedUserOperations: UserOperation[]
    validationResult: (
        | validation.ValidationResult
        | validation.ValidationResultWithAggregation
    ) & {
        storageMap: validation.StorageMap
        referencedContracts?: ReferencedCodeHashes
    }
}> => {
    const queuedUserOperations: UserOperation[] =
        await rpcHandler.mempool.getQueuedOustandingUserOps({
            userOp: userOperation,
            entryPoint
        })
    const validationResult = await rpcHandler.validator.validateUserOperation({
        userOperation,
        queuedUserOperations,
        entryPoint
    })

    return {
        queuedUserOperations,
        validationResult
    }
}

export async function addToMempoolIfValid({
    rpcHandler,
    userOperation,
    entryPoint,
    apiVersion,
    boost = false
}: {
    rpcHandler: RpcHandler
    userOperation: UserOperation
    entryPoint: Address
    apiVersion: ApiVersion
    boost?: boolean
}): Promise<{ userOpHash: Hex; result: "added" | "queued" }> {
    rpcHandler.ensureEntryPointIsSupported(entryPoint)

    // Execute multiple async operations in parallel
    const [
        userOpHash,
        { queuedUserOperations, validationResult },
        currentNonceSeq,
        [pvgSuccess, pvgErrorReason],
        [preMempoolSuccess, preMempoolError],
        [validEip7702Auth, validEip7702AuthError]
    ] = await Promise.all([
        getUserOperationHash({
            userOperation: userOperation,
            entryPointAddress: entryPoint,
            chainId: rpcHandler.config.chainId,
            publicClient: rpcHandler.config.publicClient
        }),
        getUserOpValidationResult(rpcHandler, userOperation, entryPoint),
        rpcHandler.getNonceSeq(userOperation, entryPoint),
        validatePvg(apiVersion, rpcHandler, userOperation, entryPoint, boost),
        rpcHandler.preMempoolChecks(userOperation, apiVersion, boost),
        rpcHandler.validateEip7702Auth({
            userOperation,
            validateSender: true
        })
    ])

    // Validate eip7702Auth
    if (!validEip7702Auth) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            validEip7702AuthError
        )
        throw new RpcError(
            validEip7702AuthError,
            ValidationErrors.InvalidFields
        )
    }

    // Pre mempool validation
    if (!preMempoolSuccess) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            preMempoolError
        )
        throw new RpcError(preMempoolError)
    }

    // PreVerificationGas validation
    if (!pvgSuccess) {
        rpcHandler.eventManager.emitFailedValidation(userOpHash, pvgErrorReason)
        throw new RpcError(pvgErrorReason, ValidationErrors.SimulateValidation)
    }

    // Nonce validation
    const [, userOpNonceSeq] = getNonceKeyAndSequence(userOperation.nonce)
    if (userOpNonceSeq < currentNonceSeq) {
        const reason =
            "UserOperation failed validation with reason: AA25 invalid account nonce"
        rpcHandler.eventManager.emitFailedValidation(userOpHash, reason, "AA25")
        throw new RpcError(reason, ValidationErrors.InvalidFields)
    }

    if (userOpNonceSeq > currentNonceSeq + 10n) {
        const reason =
            "UserOperation failed validaiton with reason: AA25 invalid account nonce"
        rpcHandler.eventManager.emitFailedValidation(userOpHash, reason, "AA25")
        throw new RpcError(reason, ValidationErrors.InvalidFields)
    }

    if (
        userOpNonceSeq >
        currentNonceSeq + BigInt(queuedUserOperations.length)
    ) {
        rpcHandler.mempool.add(userOperation, entryPoint)
        rpcHandler.eventManager.emitQueued(userOpHash)
        return { result: "queued", userOpHash }
    }

    // userOp validation
    if (rpcHandler.config.dangerousSkipUserOperationValidation) {
        const [isMempoolAddSuccess, mempoolAddError] =
            await rpcHandler.mempool.add(userOperation, entryPoint)

        if (!isMempoolAddSuccess) {
            rpcHandler.eventManager.emitFailedValidation(
                userOpHash,
                mempoolAddError,
                getAAError(mempoolAddError)
            )
            throw new RpcError(mempoolAddError, ValidationErrors.InvalidFields)
        }
        return { result: "added", userOpHash }
    }

    // ERC-7562 scope rule validation
    rpcHandler.reputationManager.checkReputation(
        userOperation,
        entryPoint,
        validationResult
    )

    await rpcHandler.mempool.checkEntityMultipleRoleViolation(
        entryPoint,
        userOperation
    )

    // Finally, add to mempool
    const [isMempoolAddSuccess, mempoolAddError] = await rpcHandler.mempool.add(
        userOperation,
        entryPoint,
        validationResult.referencedContracts
    )

    if (!isMempoolAddSuccess) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            mempoolAddError,
            getAAError(mempoolAddError)
        )
        throw new RpcError(mempoolAddError, ValidationErrors.InvalidFields)
    }

    return { result: "added", userOpHash }
}

export const ethSendUserOperationHandler = createMethodHandler({
    method: "eth_sendUserOperation",
    schema: sendUserOperationSchema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        const [userOperation, entryPoint] = params

        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            const { result, userOpHash } = await addToMempoolIfValid({
                rpcHandler,
                userOperation,
                entryPoint,
                apiVersion
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
                    type: "regular"
                })
                .inc()
        }
    }
})
