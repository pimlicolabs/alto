import {
    type Address,
    type ApiVersion,
    ERC7769Errors,
    type ReferencedCodeHashes,
    RpcError,
    type StorageMap,
    type UserOpInfo,
    type UserOperation,
    type ValidationResult,
    sendUserOperationSchema
} from "@alto/types"
import { getAAError } from "@alto/utils"
import { type Hex, slice } from "viem"
import type { AltoConfig } from "../../createConfig"
import { getFilterOpsResult } from "../../executor/filterOpsAndEstimateGas"
import {
    getNonceKeyAndSequence,
    getUserOpHash,
    getViemEntryPointVersion
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
    entryPoint,
    config
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    config: AltoConfig
}): Promise<[boolean, string]> => {
    // Monad-specific validation
    if (config.chainType === "monad") {
        const { gasPriceManager } = rpcHandler
        const { publicClient, utilityWalletAddress } = config
        const senderCode = await publicClient.getCode({
            address: userOp.sender
        })

        const is7702Delegated =
            senderCode && slice(senderCode, 0, 3) === "0xef0100"

        if (is7702Delegated || userOp.eip7702Auth) {
            // Need to do a balance reserve check for 7702 userOps
            try {
                const userOpInfo = {
                    userOp,
                    userOpHash: getUserOpHash({
                        userOp,
                        entryPointAddress: entryPoint,
                        chainId: rpcHandler.config.chainId
                    }),
                    addedToMempool: Date.now(),
                    submissionAttempts: 0
                }

                const userOpBundle = {
                    entryPoint,
                    version: getViemEntryPointVersion(userOp, entryPoint),
                    userOps: [userOpInfo],
                    submissionAttempts: 0
                }

                await getFilterOpsResult({
                    userOpBundle,
                    config,
                    networkBaseFee: await gasPriceManager.getBaseFee(),
                    beneficiary: utilityWalletAddress
                })
            } catch {
                return [
                    false,
                    "Balance reserve error: userOp.sender needs atleast 10 MON at the end of transaction."
                ]
            }
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
    isBoosted = false
}: {
    apiVersion: ApiVersion
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    config: AltoConfig
    isBoosted?: boolean
}): Promise<[boolean, string]> => {
    // PVG validation is skipped for v1
    if (apiVersion === "v1" || isBoosted) {
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

const getUserOpValidationResult = async ({
    rpcHandler,
    userOp,
    entryPoint
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
}): Promise<{
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
    isBoosted = false
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    apiVersion: ApiVersion
    isBoosted?: boolean
}): Promise<{ userOpHash: Hex; result: "added" | "queued" }> {
    rpcHandler.ensureEntryPointIsSupported(entryPoint)

    // Validate userOp fields (sync - fail fast before expensive async checks)
    const [fieldsValid, fieldsError] = rpcHandler.validateUserOpFields({
        userOp,
        entryPoint,
        isBoosted
    })
    if (!fieldsValid) {
        throw new RpcError(fieldsError, ERC7769Errors.InvalidFields)
    }

    const userOpHash = getUserOpHash({
        userOp,
        entryPointAddress: entryPoint,
        chainId: rpcHandler.config.chainId
    })

    const userOpInfo: UserOpInfo = {
        userOp,
        userOpHash,
        addedToMempool: Date.now(),
        submissionAttempts: 0
    }

    // Execute multiple async operations in parallel
    const [
        { queuedUserOps, validationResult },
        currentNonceSeq,
        [isPvgValid, pvgError],
        [isGasPriceValid, gasPriceError],
        [isEip7702AuthValid, eip7702AuthError],
        [isChainRulesValid, chainRulesError]
    ] = await Promise.all([
        getUserOpValidationResult({ rpcHandler, userOp, entryPoint }),
        rpcHandler.getNonceSeq({ userOp, entryPoint }),
        validatePvg({
            apiVersion,
            rpcHandler,
            userOp,
            entryPoint,
            isBoosted,
            config: rpcHandler.config
        }),
        rpcHandler.validateUserOpGasPrice({ userOp, apiVersion, isBoosted }),
        rpcHandler.validateEip7702Auth({
            userOp,
            validateSender: true
        }),
        validateChainRules({
            rpcHandler,
            userOp,
            entryPoint,
            config: rpcHandler.config
        })
    ])

    // Validate eip7702Auth
    if (!isEip7702AuthValid) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            eip7702AuthError
        )
        throw new RpcError(eip7702AuthError, ERC7769Errors.InvalidFields)
    }

    // Gas price validation
    if (!isGasPriceValid) {
        rpcHandler.eventManager.emitFailedValidation(userOpHash, gasPriceError)
        throw new RpcError(gasPriceError, ERC7769Errors.InvalidFields)
    }

    // PreVerificationGas validation
    if (!isPvgValid) {
        rpcHandler.eventManager.emitFailedValidation(userOpHash, pvgError)
        throw new RpcError(pvgError, ERC7769Errors.SimulateValidation)
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
        rpcHandler.mempool.add({ userOpInfo, entryPoint })
        rpcHandler.eventManager.emitQueued(userOpHash)
        return { result: "queued", userOpHash }
    }

    // Chain rules validation
    if (!isChainRulesValid) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            chainRulesError
        )
        throw new RpcError(chainRulesError, ERC7769Errors.InvalidFields)
    }

    // userOp validation
    if (rpcHandler.config.dangerousSkipUserOperationValidation) {
        const [isMempoolAddSuccess, mempoolAddError] =
            await rpcHandler.mempool.add({ userOpInfo, entryPoint })

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
        {
            userOpInfo,
            entryPoint
        }
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
