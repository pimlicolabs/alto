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

const validatePvg = async (
    apiVersion: ApiVersion,
    rpcHandler: RpcHandler,
    userOperation: UserOperation,
    entryPoint: Address
): Promise<[boolean, string]> => {
    // PVG validation is skipped for v1
    if (apiVersion == "v1") {
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

export async function addToMempoolIfValid(
    rpcHandler: RpcHandler,
    userOperation: UserOperation,
    entryPoint: Address,
    apiVersion: ApiVersion
): Promise<"added" | "queued"> {
    rpcHandler.ensureEntryPointIsSupported(entryPoint)

    const userOpHash = await getUserOperationHash({
        userOperation: userOperation,
        entryPointAddress: entryPoint,
        chainId: rpcHandler.config.chainId,
        publicClient: rpcHandler.config.publicClient
    })

    const { queuedUserOperations, validationResult } =
        await getUserOpValidationResult(rpcHandler, userOperation, entryPoint)

    const [pvgSuccess, pvgErrorReason] = await validatePvg(
        apiVersion,
        rpcHandler,
        userOperation,
        entryPoint
    )

    const currentNonceSeq = await rpcHandler.getNonceSeq(
        userOperation,
        entryPoint
    )
    const [, userOpNonceSeq] = getNonceKeyAndSequence(userOperation.nonce)

    const [preMempoolSuccess, preMempoolError] =
        await rpcHandler.preMempoolChecks(userOperation, apiVersion)

    // Pre mempool validation
    if (!preMempoolSuccess) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            preMempoolError
        )
        throw new RpcError(preMempoolError)
    }

    if (!pvgSuccess) {
        rpcHandler.eventManager.emitFailedValidation(userOpHash, pvgErrorReason)
        throw new RpcError(pvgErrorReason, ValidationErrors.SimulateValidation)
    }

    // Nonce validation
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
        return "queued"
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
        return "added"
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
