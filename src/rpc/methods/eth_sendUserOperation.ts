import {
    type Address,
    type ApiVersion,
    ERC7769Errors,
    RpcError,
    type UserOpInfo,
    type UserOperation,
    sendUserOperationSchema
} from "@alto/types"
import {
    getAAError,
    maxBigInt,
    minBigInt,
    scaleBigIntByPercent
} from "@alto/utils"
import { BaseError, type Hex, slice, toFunctionSelector, toHex } from "viem"
import type { AltoConfig } from "../../createConfig"
import { getFilterOpsResult } from "../../executor/filterOpsAndEstimateGas"
import { encodeHandleOpsCalldata } from "../../executor/utils"
import { getEip7702DelegationOverrides } from "../../utils/eip7702"
import { TX_MAX_GAS_LIMIT } from "../../utils/eip8037"
import {
    NESTED_HANDLE_OPS_DETECTOR,
    getNestedHandleOpsSimulation,
    supportsNestedHandleOpsDetector
} from "../../utils/entryPointOverrides"
import {
    getNonceKeyAndSequence,
    getUserOpHash,
    getViemEntryPointVersion,
    isVersion06
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

// eth_estimateGas stops searching once its window is under 1.5% of the gas
// it returns (geth), so the smallest gas a userOp passes with can be up to
// 1.5% below it
const ESTIMATE_GAS_ERROR_PER_MILLE = 15n

// Smallest reservoir the userOp can need, given eth_estimateGas's tolerance
const getLowestReservoirGas = (reservoirGas: bigint): bigint => {
    const gas = TX_MAX_GAS_LIMIT + reservoirGas
    const lowestGas = gas - (gas * ESTIMATE_GAS_ERROR_PER_MILLE) / 1000n
    return maxBigInt(lowestGas - TX_MAX_GAS_LIMIT, 0n)
}

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
}): Promise<{ valid: true } | { valid: false; error: string }> => {
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
                return {
                    valid: false,
                    error: "Balance reserve error: userOp.sender needs atleast 10 MON at the end of transaction."
                }
            }
        }
    }

    // Add more chain-specific validations here in the future

    return { valid: true }
}

// The preVerificationGas the userOp needs. With validate, the L2 fee inputs
// are the most lenient seen recently (the floor eth_sendUserOperation
// enforces). Without, they are the current ones, as used by
// eth_estimateUserOperationGas.
const getPvg = async ({
    rpcHandler,
    userOp,
    entryPoint,
    validate
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    validate: boolean
}): Promise<bigint> => {
    const { config, gasPriceManager } = rpcHandler

    if (config.chainType === "monad") {
        // Monad consumes the entire gasLimit, so PVG is calculated differently
        return await getMonadPvg({ userOp, config, entryPoint, validate })
    }

    const [dynamicPvgComponent, l2PvgComponent] = await Promise.all([
        getDynamicPvgComponent({ userOp, entryPoint, config }),
        getL2PvgComponent({
            config,
            userOp,
            entryPoint,
            gasPriceManager,
            validate
        })
    ])
    const basePvgComponent = getBasePvgComponent({
        userOp,
        config,
        dynamicPvgComponent
    })
    return basePvgComponent + l2PvgComponent
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
}): Promise<
    { valid: true; requiredPvg: bigint } | { valid: false; error: string }
> => {
    // PVG validation is skipped for v1 and boosted userOperations, and in
    // emergency mode where the L2 fee inputs come from RPC reads that may be
    // stale, slow, or replaced by the emergency fallback.
    if (apiVersion === "v1" || isBoosted || config.emergencyMode) {
        return { valid: true, requiredPvg: 0n }
    }

    const requiredPvg = await getPvg({
        rpcHandler,
        userOp,
        entryPoint,
        validate: true
    })

    if (requiredPvg > userOp.preVerificationGas) {
        return {
            valid: false,
            error: `preVerificationGas is not enough, required: ${requiredPvg}, got: ${userOp.preVerificationGas}`
        }
    }

    return { valid: true, requiredPvg }
}

// Caps preVerificationGas at --max-pre-verification-gas-multiplier of what
// eth_estimateUserOperationGas returns. preVerificationGas is charged in full
// whatever the userOp uses, so an inflated value drains the paymaster
// sponsoring it. Enforced on every apiVersion, as the sender picks it.
export const validateMaxPvg = async ({
    rpcHandler,
    userOp,
    entryPoint,
    isBoosted = false,
    reservoirGas = 0n
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    isBoosted?: boolean
    // EIP-8037 state gas reservoir, which eth_estimateUserOperationGas adds
    // to the preVerificationGas of a userOp that pays
    reservoirGas?: bigint
}): Promise<[boolean, string]> => {
    const {
        maxPreVerificationGasMultiplier,
        emergencyMode,
        v6PreVerificationGasLimitMultiplier,
        v7PreVerificationGasLimitMultiplier
    } = rpcHandler.config

    // Boosted userOps pay no gas. Emergency mode skips it for the same
    // reason as validatePvg.
    if (maxPreVerificationGasMultiplier === 0n || isBoosted || emergencyMode) {
        return [true, ""]
    }

    const pvg = await getPvg({
        rpcHandler,
        userOp,
        entryPoint,
        validate: false
    })

    // Same multipliers as eth_estimateUserOperationGas.
    const estimatedPvg = scaleBigIntByPercent(
        pvg,
        isVersion06(userOp)
            ? v6PreVerificationGasLimitMultiplier
            : v7PreVerificationGasLimitMultiplier
    )
    const maxPvg = scaleBigIntByPercent(
        estimatedPvg + reservoirGas,
        maxPreVerificationGasMultiplier
    )

    if (userOp.preVerificationGas > maxPvg) {
        return [
            false,
            `preVerificationGas is too high, max: ${maxPvg}, got: ${userOp.preVerificationGas}`
        ]
    }

    return [true, ""]
}

// Revert data of a handleOps simulated with getNestedHandleOpsSimulation when
// a nested handleOps landed.
const NESTED_HANDLE_OPS_REVERTS = [
    // NestedHandleOpsDetector's error, wrapped in FailedSendToBeneficiary by
    // v0.9.
    toFunctionSelector("NestedHandleOps()"),
    // v0.6 to v0.8 revert with this when the beneficiary reverts.
    toHex("AA91 failed send to beneficiary")
].map((data) => data.slice(2).toLowerCase())

const getRevertData = (err: unknown): Hex | undefined => {
    if (!(err instanceof BaseError)) {
        return undefined
    }

    let revertData: Hex | undefined
    err.walk((e) => {
        const data = (e as { data?: unknown }).data
        const match =
            typeof data === "string" ? data.match(/0x[a-fA-F0-9]*/) : null
        if (match) {
            revertData = match[0] as Hex
            return true
        }
        return false
    })
    return revertData
}

// Rejects userOps that call handleOps on another EntryPoint while they run
// (each EntryPoint blocks reentrant handleOps). The nested userOperations are
// paid for by their own paymasters and pay a beneficiary the sender picks, so
// a sponsored userOp can drain paymasters on other EntryPoints. Simulates
// handleOps with eth_call and the overrides of getNestedHandleOpsSimulation,
// from an EOA so v0.9's reentrancy guard passes.
export const validateNoNestedUserOps = async ({
    rpcHandler,
    userOp,
    userOpHash,
    queuedUserOps,
    entryPoint
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    userOpHash: Hex
    queuedUserOps: UserOperation[]
    entryPoint: Address
}): Promise<[boolean, string]> => {
    const {
        rejectNestedUserOperations,
        codeOverrideSupport,
        dangerousSkipUserOperationValidation,
        publicClient,
        fixedGasLimitForEstimation,
        utilityWalletAddress,
        entrypoints
    } = rpcHandler.config

    if (
        !rejectNestedUserOperations ||
        !codeOverrideSupport ||
        dangerousSkipUserOperationValidation ||
        !(await supportsNestedHandleOpsDetector(publicClient))
    ) {
        return [true, ""]
    }

    // Queued userOps go first so the userOp's nonce is valid.
    const userOps = [...queuedUserOps, userOp]
    const simulation = await getNestedHandleOpsSimulation({
        publicClient,
        entryPoint,
        supportedEntryPoints: entrypoints
    })

    try {
        await publicClient.call({
            account: utilityWalletAddress,
            to: entryPoint,
            gas: fixedGasLimitForEstimation,
            data: encodeHandleOpsCalldata({
                userOps,
                beneficiary: NESTED_HANDLE_OPS_DETECTOR
            }),
            stateOverride: [
                ...(getEip7702DelegationOverrides(userOps) ?? []),
                ...simulation.stateOverride
            ],
            accessList: simulation.accessList
        })
    } catch (err) {
        const revertData = getRevertData(err)?.toLowerCase()
        if (revertData === undefined) {
            throw err
        }

        if (
            NESTED_HANDLE_OPS_REVERTS.some((nestedRevert) =>
                revertData.includes(nestedRevert)
            )
        ) {
            rpcHandler.logger.warn(
                { userOpHash, entryPoint, sender: userOp.sender },
                "Rejected userOperation that calls handleOps"
            )
            return [
                false,
                "userOperation calls handleOps on another EntryPoint, nested userOperations are not allowed"
            ]
        }

        // Any other revert is a failed validation, which validateUserOp
        // reports.
    }

    return [true, ""]
}

const getQueuedUserOps = async ({
    rpcHandler,
    userOp,
    entryPoint
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
}): Promise<UserOperation[]> => {
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

    return queuedUserOps
}

const getUserOpValidationResult = async ({
    rpcHandler,
    userOp,
    entryPoint,
    queuedUserOps,
    isBoosted
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    queuedUserOps: UserOperation[]
    isBoosted: boolean
}) => {
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

    const queuedUserOps = await getQueuedUserOps({
        rpcHandler,
        userOp,
        entryPoint
    })

    // Execute multiple async operations in parallel
    const [
        {
            validationResult,
            minReservoirGas,
            reservoirGas,
            maxPvgResult: [isPvgBelowMax, maxPvgError]
        },
        [isNestedUserOpsValid, nestedUserOpsError],
        currentNonceSeq,
        pvgResult,
        [isGasPriceValid, gasPriceError],
        [isEip7702AuthValid, eip7702AuthError],
        chainRulesResult
    ] = await Promise.all([
        // The max preVerificationGas allows for the reservoir, so it waits
        // for the reservoir search
        getUserOpValidationResult({
            rpcHandler,
            userOp,
            entryPoint,
            queuedUserOps,
            isBoosted
        }).then(async (result) => ({
            ...result,
            maxPvgResult: await validateMaxPvg({
                rpcHandler,
                userOp,
                entryPoint,
                isBoosted,
                reservoirGas: result.minReservoirGas
            })
        })),
        validateNoNestedUserOps({
            rpcHandler,
            userOp,
            userOpHash,
            queuedUserOps,
            entryPoint
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

    if (!isNestedUserOpsValid) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            nestedUserOpsError
        )
        throw new RpcError(nestedUserOpsError, ERC7769Errors.OpcodeValidation)
    }

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
    if (!pvgResult.valid) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            pvgResult.error
        )
        throw new RpcError(pvgResult.error, ERC7769Errors.SimulateValidation)
    }
    const { requiredPvg } = pvgResult

    // The EntryPoint never charges reservoir gas to the userOp, so a userOp
    // that pays must cover the reservoir in preVerificationGas
    const requiredReservoirPvg =
        !isBoosted && minReservoirGas
            ? requiredPvg + getLowestReservoirGas(minReservoirGas)
            : 0n
    if (userOp.preVerificationGas < requiredReservoirPvg) {
        const reason = `preVerificationGas is not enough to pay for the EIP-8037 state gas reservoir, required: ${requiredReservoirPvg}, got: ${userOp.preVerificationGas}`
        rpcHandler.eventManager.emitFailedValidation(userOpHash, reason)
        throw new RpcError(reason, ERC7769Errors.SimulateValidation)
    }

    // A paid userOp is bundled with the reservoir its preVerificationGas
    // covers, so the bundler doesn't pay for reservoir gas it isn't paid for
    userOpInfo.reservoirGas =
        !isBoosted && reservoirGas
            ? minBigInt(reservoirGas, userOp.preVerificationGas - requiredPvg)
            : reservoirGas

    if (!isPvgBelowMax) {
        rpcHandler.eventManager.emitFailedValidation(userOpHash, maxPvgError)
        throw new RpcError(maxPvgError, ERC7769Errors.InvalidFields)
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
    if (!chainRulesResult.valid) {
        rpcHandler.eventManager.emitFailedValidation(
            userOpHash,
            chainRulesResult.error
        )
        throw new RpcError(chainRulesResult.error, ERC7769Errors.InvalidFields)
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
