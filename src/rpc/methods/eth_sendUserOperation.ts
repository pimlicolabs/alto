import {
    type Address,
    type ApiVersion,
    type ReferencedCodeHashes,
    RpcError,
    type UserOperation,
    ValidationErrors,
    sendUserOperationSchema
} from "@alto/types"
import type * as validation from "@alto/types"
import {
    calcExecutionPvgComponent,
    calcL2PvgComponent,
    getAAError
} from "@alto/utils"
import type { Hex } from "viem"
import { getNonceKeyAndSequence, getUserOpHash } from "../../utils/userop"
import { createMethodHandler } from "../createMethodHandler"
import type { RpcHandler } from "../rpcHandler"

const validatePvg = async (
    apiVersion: ApiVersion,
    rpcHandler: RpcHandler,
    userOp: UserOperation,
    entryPoint: Address,
    boost = false
): Promise<[boolean, string]> => {
    // PVG validation is skipped for v1
    if (apiVersion === "v1" || boost) {
        return [true, ""]
    }

    const executionGasComponent = calcExecutionPvgComponent({
        userOp,
        supportsEip7623: rpcHandler.config.supportsEip7623,
        config: rpcHandler.config
    })
    const l2GasComponent = await calcL2PvgComponent({
        config: rpcHandler.config,
        userOp,
        entryPoint,
        gasPriceManager: rpcHandler.gasPriceManager,
        validate: true
    })
    const requiredPvg = executionGasComponent + l2GasComponent

    if (requiredPvg > userOp.preVerificationGas) {
        return [
            false,
            `preVerificationGas is not enough, required: ${requiredPvg}, got: ${userOp.preVerificationGas}`
        ]
    }

    return [true, ""]
}

const getUserOpValidationResult = async (
    rpcHandler: RpcHandler,
    userOp: UserOperation,
    entryPoint: Address
): Promise<{
    queuedUserOps: UserOperation[]
    validationResult: validation.ValidationResult & {
        storageMap: validation.StorageMap
        referencedContracts?: ReferencedCodeHashes
    }
}> => {
    const queuedUserOps: UserOperation[] =
        await rpcHandler.mempool.getQueuedOutstandingUserOps({
            userOp,
            entryPoint
        })
    const validationResult = await rpcHandler.validator.validateUserOp({
        userOp,
        queuedUserOps,
        entryPoint
    })

    return {
        queuedUserOps,
        validationResult
    }
}

export async function addToMempoolIfValid({
    rpcHandler,
    userOp,
    entryPoint,
    apiVersion,
    boost = false
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    apiVersion: ApiVersion
    boost?: boolean
}): Promise<{ userOpHash: Hex; result: "added" | "queued" }> {
    rpcHandler.ensureEntryPointIsSupported(entryPoint)

    // Execute multiple async operations in parallel
    const [
        userOpHash,
        { queuedUserOps, validationResult },
        currentNonceSeq,
        [pvgSuccess, pvgErrorReason],
        [preMempoolSuccess, preMempoolError],
        [validEip7702Auth, validEip7702AuthError]
    ] = await Promise.all([
        getUserOpHash({
            userOp,
            entryPointAddress: entryPoint,
            chainId: rpcHandler.config.chainId,
            publicClient: rpcHandler.config.publicClient
        }),
        getUserOpValidationResult(rpcHandler, userOp, entryPoint),
        rpcHandler.getNonceSeq(userOp, entryPoint),
        validatePvg(apiVersion, rpcHandler, userOp, entryPoint, boost),
        rpcHandler.preMempoolChecks(userOp, apiVersion, boost),
        rpcHandler.validateEip7702Auth({
            userOp,
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
        throw new RpcError(preMempoolError, ValidationErrors.InvalidFields)
    }

    // PreVerificationGas validation
    if (!pvgSuccess) {
        rpcHandler.eventManager.emitFailedValidation(userOpHash, pvgErrorReason)
        throw new RpcError(pvgErrorReason, ValidationErrors.SimulateValidation)
    }

    // Nonce validation
    const [, userOpNonceSeq] = getNonceKeyAndSequence(userOp.nonce)
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

    if (userOpNonceSeq > currentNonceSeq + BigInt(queuedUserOps.length)) {
        rpcHandler.mempool.add(userOp, entryPoint)
        rpcHandler.eventManager.emitQueued(userOpHash)
        return { result: "queued", userOpHash }
    }

    // userOp validation
    if (rpcHandler.config.dangerousSkipUserOperationValidation) {
        const [isMempoolAddSuccess, mempoolAddError] =
            await rpcHandler.mempool.add(userOp, entryPoint)

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
        userOp,
        entryPoint,
        validationResult
    )

    await rpcHandler.mempool.checkEntityMultipleRoleViolation(
        entryPoint,
        userOp
    )

    // Finally, add to mempool
    const [isMempoolAddSuccess, mempoolAddError] = await rpcHandler.mempool.add(
        userOp,
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
        const [userOp, entryPoint] = params

        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            const { result, userOpHash } = await addToMempoolIfValid({
                rpcHandler,
                userOp,
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
            rpcHandler.metrics.userOpsReceived
                .labels({
                    status,
                    type: userOp.eip7702Auth ? "7702" : "regular"
                })
                .inc()
        }
    }
})
