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
import { getAAError, scaleBigIntByPercent } from "@alto/utils"
import { type Hex, slice } from "viem"
import type { AltoConfig } from "../../createConfig"
import { getFilterOpsResult } from "../../executor/filterOpsAndEstimateGas"
import { TX_MAX_GAS_LIMIT } from "../../utils/eip8037"
import {
    getNonceKeyAndSequence,
    getUserOpHash,
    getViemEntryPointVersion
} from "../../utils/userop"
import { createMethodHandler } from "../createMethodHandler"
import {
    getBasePvgComponent,
    getDynamicPvgComponent,
    getL2PvgComponent,
    getMonadPvg
} from "../estimation/preVerificationGas"
import type { RpcHandler } from "../rpcHandler"

// Buffer on the EIP-8037 state gas reservoir the bundler fronts for a
// boosted userOp
const BOOSTED_RESERVOIR_GAS_MULTIPLIER = 120n

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
                    receivedAt: Date.now(),
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
}): Promise<[boolean, string, bigint]> => {
    // PVG validation is skipped for v1 and boosted userOperations, and in
    // emergency mode where the L2 fee inputs come from RPC reads that may be
    // stale, slow, or replaced by the emergency fallback.
    if (apiVersion === "v1" || isBoosted || config.emergencyMode) {
        return [true, "", 0n]
    }

    let requiredPvg: bigint

    if (config.chainType === "monad") {
        // Monad consumes the entire gasLimit, so PVG is calculated differently
        requiredPvg = await getMonadPvg({
            userOp,
            config,
            entryPoint,
            validate: true
        })
    } else {
        const [dynamicPvgComponent, l2PvgComponent] = await Promise.all([
            getDynamicPvgComponent({
                userOp,
                entryPoint,
                config: rpcHandler.config
            }),
            getL2PvgComponent({
                config: rpcHandler.config,
                userOp,
                entryPoint,
                gasPriceManager: rpcHandler.gasPriceManager,
                validate: true
            })
        ])
        const basePvgComponent = getBasePvgComponent({
            userOp,
            config: rpcHandler.config,
            dynamicPvgComponent
        })
        requiredPvg = basePvgComponent + l2PvgComponent
    }

    if (requiredPvg > userOp.preVerificationGas) {
        return [
            false,
            `preVerificationGas is not enough, required: ${requiredPvg}, got: ${userOp.preVerificationGas}`,
            requiredPvg
        ]
    }

    return [true, "", requiredPvg]
}

const getUserOpValidationResult = async ({
    rpcHandler,
    userOp,
    entryPoint,
    isBoosted
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    isBoosted: boolean
}): Promise<{
    queuedUserOps: UserOperation[]
    validationResult: ValidationResult & {
        storageMap: StorageMap
        referencedContracts?: ReferencedCodeHashes
    }
    minReservoirGas?: bigint
    reservoirGas?: bigint
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

    // A userOp that needs more than TX_MAX_GAS_LIMIT including EIP-8037
    // state gas is bundled with a state gas reservoir.
    //
    // A userOp that pays gets exactly the reservoir it pays for: state gas is
    // taken from the reservoir before gas_left, so a bigger reservoir would
    // pay for state gas that would otherwise come out of its callGasLimit,
    // which the EntryPoint charges. The bundler pays for boosted userOps, and
    // unused reservoir gas isn't charged, so their buffer only absorbs state
    // that changes before inclusion.
    let minReservoirGas: bigint | undefined
    let reservoirGas: bigint | undefined
    if (rpcHandler.config.supportsEip8037) {
        minReservoirGas = await rpcHandler.validator.findReservoirGas({
            userOp,
            entryPoint,
            queuedUserOps,
            maxReservoirGas: rpcHandler.config.maxReservoirGas
        })

        if (minReservoirGas) {
            reservoirGas = isBoosted
                ? scaleBigIntByPercent(
                      minReservoirGas,
                      BOOSTED_RESERVOIR_GAS_MULTIPLIER
                  )
                : minReservoirGas
        }
    }

    const validator = reservoirGas
        ? rpcHandler.validator.withSimulationGasLimit(
              TX_MAX_GAS_LIMIT + reservoirGas
          )
        : rpcHandler.validator
    const validationResult = await validator.validateUserOp({
        userOp,
        queuedUserOps,
        entryPoint
    })

    return {
        minReservoirGas,
        reservoirGas,
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

    const receivedAt = Date.now()
    const userOpInfo: UserOpInfo = {
        userOp,
        userOpHash,
        receivedAt,
        addedToMempool: receivedAt, // deprecated alias, see withReceivedAt
        submissionAttempts: 0
    }

    // Execute multiple async operations in parallel
    const [
        { queuedUserOps, validationResult, minReservoirGas, reservoirGas },
        currentNonceSeq,
        [isPvgValid, pvgError, requiredPvg],
        [isGasPriceValid, gasPriceError],
        [isEip7702AuthValid, eip7702AuthError],
        [isChainRulesValid, chainRulesError]
    ] = await Promise.all([
        getUserOpValidationResult({
            rpcHandler,
            userOp,
            entryPoint,
            isBoosted
        }),
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
            validateSignature: true
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

    // The EntryPoint never charges reservoir gas to the userOp, so a userOp
    // that pays must cover the reservoir in preVerificationGas
    if (
        !isBoosted &&
        minReservoirGas &&
        userOp.preVerificationGas < requiredPvg + minReservoirGas
    ) {
        const reason = `preVerificationGas is not enough to pay for the EIP-8037 state gas reservoir, required: ${requiredPvg + minReservoirGas}, got: ${userOp.preVerificationGas}`
        rpcHandler.eventManager.emitFailedValidation(userOpHash, reason)
        throw new RpcError(reason, ERC7769Errors.SimulateValidation)
    }

    userOpInfo.reservoirGas = reservoirGas

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
