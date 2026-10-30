import {
    type Address,
    type ApiVersion,
    ERC7769Errors,
    EntryPointV06Abi,
    EntryPointV07Abi,
    RpcError,
    type UserOpInfo,
    type UserOperation,
    sendUserOperationSchema
} from "@alto/types"
import {
    getAAError,
    getAuthorizationStateOverrides,
    scaleBigIntByPercent
} from "@alto/utils"
import { type Hex, getAbiItem, slice, toFunctionSelector } from "viem"
import type { AltoConfig } from "../../createConfig"
import { getFilterOpsResult } from "../../executor/filterOpsAndEstimateGas"
import { encodeHandleOpsCalldata } from "../../executor/utils"
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
import { debug_traceCall } from "../validation/tracer"

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
}): Promise<[boolean, string]> => {
    // PVG validation is skipped for v1 and boosted userOperations, and in
    // emergency mode where the L2 fee inputs come from RPC reads that may be
    // stale, slow, or replaced by the emergency fallback.
    if (apiVersion === "v1" || isBoosted || config.emergencyMode) {
        return [true, ""]
    }

    const requiredPvg = await getPvg({
        rpcHandler,
        userOp,
        entryPoint,
        validate: true
    })

    if (requiredPvg > userOp.preVerificationGas) {
        return [
            false,
            `preVerificationGas is not enough, required: ${requiredPvg}, got: ${userOp.preVerificationGas}`
        ]
    }

    return [true, ""]
}

// Caps preVerificationGas at --max-pre-verification-gas-multiplier of what
// eth_estimateUserOperationGas returns. preVerificationGas is charged in full
// whatever the userOp uses, so an inflated value drains the paymaster
// sponsoring it. Enforced on every apiVersion, as the sender picks it.
export const validateMaxPvg = async ({
    rpcHandler,
    userOp,
    entryPoint,
    isBoosted = false
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    isBoosted?: boolean
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
        estimatedPvg,
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

// Selectors that run userOperations on an EntryPoint. v0.8 and v0.9 share
// v0.7's.
const HANDLE_OPS_SELECTORS = new Set<Hex>([
    toFunctionSelector(
        getAbiItem({ abi: EntryPointV06Abi, name: "handleOps" })
    ),
    toFunctionSelector(
        getAbiItem({ abi: EntryPointV06Abi, name: "handleAggregatedOps" })
    ),
    toFunctionSelector(
        getAbiItem({ abi: EntryPointV07Abi, name: "handleOps" })
    ),
    toFunctionSelector(
        getAbiItem({ abi: EntryPointV07Abi, name: "handleAggregatedOps" })
    )
])

// A call frame returned by geth's callTracer.
type CallFrame = {
    type: string
    from: Address
    to?: Address
    input?: Hex
    calls?: CallFrame[]
}

const findHandleOpsCall = (frames: CallFrame[]): CallFrame | undefined => {
    for (const frame of frames) {
        const selector = frame.input?.slice(0, 10).toLowerCase() as Hex
        if (HANDLE_OPS_SELECTORS.has(selector)) {
            return frame
        }

        const nestedFrame = findHandleOpsCall(frame.calls ?? [])
        if (nestedFrame) {
            return nestedFrame
        }
    }

    return undefined
}

// Rejects userOps that call handleOps while they run, on this EntryPoint or
// another one. The nested userOperations are paid for by their own paymasters
// and pay out to a beneficiary the sender picks, so a sponsored userOp can
// drain paymasters on other EntryPoints. Runs the userOp through handleOps
// with geth's callTracer, from an EOA so v0.8+'s reentrancy guard passes.
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
        dangerousSkipUserOperationValidation,
        publicClient,
        fixedGasLimitForEstimation,
        utilityWalletAddress
    } = rpcHandler.config

    if (!rejectNestedUserOperations || dangerousSkipUserOperationValidation) {
        return [true, ""]
    }

    // Queued userOps go first so the userOp's nonce is valid.
    const userOps = [...queuedUserOps, userOp]
    const trace: CallFrame = await debug_traceCall(
        publicClient,
        {
            from: utilityWalletAddress,
            to: entryPoint,
            gas: fixedGasLimitForEstimation,
            data: encodeHandleOpsCalldata({
                userOps,
                beneficiary: utilityWalletAddress
            })
        },
        {
            tracer: "callTracer",
            stateOverrides: getAuthorizationStateOverrides({ userOps })
        }
    )

    // The top-level frame is the handleOps call above, so only search below it.
    const handleOpsCall = findHandleOpsCall(trace.calls ?? [])
    if (handleOpsCall) {
        rpcHandler.logger.warn(
            {
                userOpHash,
                entryPoint,
                sender: userOp.sender,
                caller: handleOpsCall.from,
                nestedEntryPoint: handleOpsCall.to
            },
            "Rejected userOperation that calls handleOps"
        )
        return [
            false,
            `userOperation calls handleOps on ${handleOpsCall.to}, nested userOperations are not allowed`
        ]
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
        validationResult,
        [isNestedUserOpsValid, nestedUserOpsError],
        currentNonceSeq,
        [isPvgValid, pvgError],
        [isPvgBelowMax, maxPvgError],
        [isGasPriceValid, gasPriceError],
        [isEip7702AuthValid, eip7702AuthError],
        [isChainRulesValid, chainRulesError]
    ] = await Promise.all([
        rpcHandler.validator.validateUserOp({
            userOp,
            queuedUserOps,
            entryPoint
        }),
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
        validateMaxPvg({ rpcHandler, userOp, entryPoint, isBoosted }),
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
    if (!isPvgValid) {
        rpcHandler.eventManager.emitFailedValidation(userOpHash, pvgError)
        throw new RpcError(pvgError, ERC7769Errors.SimulateValidation)
    }

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
