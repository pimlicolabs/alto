import {
    type Address,
    type ApiVersion,
    ERC7769Errors,
    type ReferencedCodeHashes,
    RpcError,
    type StorageMap,
    type UserOperation,
    type ValidationResult,
    sendUserOperationSchema
} from "@alto/types"
import { getAAError } from "@alto/utils"
import { type Hex, formatEther } from "viem"
import type { AltoConfig } from "../../createConfig"
import {
    calculateRequiredPrefund,
    getNonceKeyAndSequence,
    getUserOpHash,
    hasPaymaster
} from "../../utils/userop"
import { createMethodHandler } from "../createMethodHandler"
import {
    calcExecutionPvgComponent,
    calcL2PvgComponent,
    calcMonadPvg
} from "../estimation/preVerificationGasCalculator"
import type { RpcHandler } from "../rpcHandler"

const validateChainRules = async ({
    rpcHandler,
    userOp,
    config
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    config: AltoConfig
}): Promise<[boolean, string]> => {
    // Monad-specific validation
    if (config.chainType === "monad") {
        // Skip validation if userOp has a paymaster
        if (hasPaymaster(userOp)) {
            return [true, ""]
        }

        // Get sender's balance
        const balance = await rpcHandler.config.publicClient.getBalance({
            address: userOp.sender
        })

        // Calculate required prefund
        const requiredPrefund = calculateRequiredPrefund(userOp)

        // Check if sender balance - prefund >= monad reserve balance
        const balanceAfterPrefund = balance - requiredPrefund
        if (balanceAfterPrefund < config.monadReserveBalance) {
            return [
                false,
                `Sender failed reserve balance check of ${formatEther(config.monadReserveBalance)} MON`
            ]
        }
    }

    // Add more chain-specific validations here in the future

    return [true, ""]
}

const validatePvg = async ({
    apiVersion,
    rpcHandler,
    userOp,
    entryPoint,
    config,
    boost = false
}: {
    apiVersion: ApiVersion
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    config: AltoConfig
    boost?: boolean
}): Promise<[boolean, string]> => {
    // PVG validation is skipped for v1
    if (apiVersion === "v1" || boost) {
        return [true, ""]
    }

    let requiredPvg: bigint

    if (config.chainType === "monad") {
        // Monad consumes the entire gasLimit, so PVG is calculated differently
        requiredPvg = await calcMonadPvg({
            userOp,
            config,
            entryPoint,
            validate: true
        })
    } else {
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
        requiredPvg = executionGasComponent + l2GasComponent
    }

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
    validationResult: ValidationResult & {
        storageMap: StorageMap
        referencedContracts?: ReferencedCodeHashes
    }
}> => {
    const queuedUserOps: UserOperation[] =
        await rpcHandler.mempool.getQueuedOutstandingUserOps({
            userOp,
            entryPoint
        })

    // Log queued userOps.
    if (queuedUserOps.length > 0) {
        const queuedHashes = queuedUserOps.map((userOp) =>
            getUserOpHash({
                userOp,
                entryPointAddress: entryPoint,
                chainId: rpcHandler.config.chainId
            })
        )

        rpcHandler.logger.info({ queuedHashes }, "Found queuedUserOps")
    }

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

    const userOpHash = getUserOpHash({
        userOp,
        entryPointAddress: entryPoint,
        chainId: rpcHandler.config.chainId
    })

    // Execute multiple async operations in parallel
    const [
        { queuedUserOps, validationResult },
        currentNonceSeq,
        [pvgSuccess, pvgErrorReason],
        [preMempoolSuccess, preMempoolError],
        [validEip7702Auth, validEip7702AuthError],
        [chainRulesSuccess, chainRulesError]
    ] = await Promise.all([
        getUserOpValidationResult(rpcHandler, userOp, entryPoint),
        rpcHandler.getNonceSeq(userOp, entryPoint),
        validatePvg({
            apiVersion,
            rpcHandler,
            userOp,
            entryPoint,
            boost,
            config: rpcHandler.config
        }),
        rpcHandler.preMempoolChecks(userOp, apiVersion, boost),
        rpcHandler.validateEip7702Auth({
            userOp,
            validateSender: true
        }),
        validateChainRules({
            rpcHandler,
            userOp,
            config: rpcHandler.config
        })
    ])

    // Validate eip7702Auth
    if (!validEip7702Auth) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            validEip7702AuthError
        )
        throw new RpcError(validEip7702AuthError, ERC7769Errors.InvalidFields)
    }

    // Pre mempool validation
    if (!preMempoolSuccess) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            preMempoolError
        )
        throw new RpcError(preMempoolError, ERC7769Errors.InvalidFields)
    }

    // PreVerificationGas validation
    if (!pvgSuccess) {
        rpcHandler.eventManager.emitFailedValidation(userOpHash, pvgErrorReason)
        throw new RpcError(pvgErrorReason, ERC7769Errors.SimulateValidation)
    }

    // Chain rules validation
    if (!chainRulesSuccess) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            chainRulesError
        )
        throw new RpcError(chainRulesError, ERC7769Errors.InvalidFields)
    }

    // Nonce validation
    const [, userOpNonceSeq] = getNonceKeyAndSequence(userOp.nonce)
    if (userOpNonceSeq < currentNonceSeq) {
        const reason =
            "UserOperation failed validation with reason: AA25 invalid account nonce"
        rpcHandler.eventManager.emitFailedValidation(userOpHash, reason, "AA25")
        throw new RpcError(reason, ERC7769Errors.SimulateValidation)
    }

    if (userOpNonceSeq > currentNonceSeq + 10n) {
        const reason =
            "UserOperation failed validaiton with reason: AA25 invalid account nonce"
        rpcHandler.eventManager.emitFailedValidation(userOpHash, reason, "AA25")
        throw new RpcError(reason, ERC7769Errors.SimulateValidation)
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
            throw new RpcError(mempoolAddError, ERC7769Errors.InvalidFields)
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
        throw new RpcError(mempoolAddError, ERC7769Errors.InvalidFields)
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
