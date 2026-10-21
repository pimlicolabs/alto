import { calculateAA95GasFloor } from "@alto/executor"
import {
    type Address,
    ERC7769Errors,
    RpcError,
    type StateOverrides,
    type UserOperation,
    estimateUserOperationGasSchema
} from "@alto/types"
import { parseEther, toHex } from "viem"
import { maxBigInt, scaleBigIntByPercent } from "../../utils/bigInt"
import { TX_MAX_GAS_LIMIT } from "../../utils/eip8037"
import {
    deepHexlify,
    getUserOpHash,
    isVersion06,
    isVersion07
} from "../../utils/userop"
import { createMethodHandler } from "../createMethodHandler"
import {
    getBasePvgComponent,
    getDynamicPvgComponent,
    getL2PvgComponent,
    getMonadPvg
} from "../estimation/preVerificationGas"
import type { RpcHandler } from "../rpcHandler"

type GasEstimateResult =
    | {
          status: "success"
          estimates: {
              verificationGasLimit: bigint
              callGasLimit: bigint
              paymasterVerificationGasLimit: bigint
              paymasterPostOpGasLimit: bigint
          }
          queuedUserOps: UserOperation[]
      }
    | {
          status: "failed"
          error: string
          code?: number
          cause?: unknown
      }

function getVerificationGasAndCallGasLimit(
    userOp: UserOperation,
    executionResult: {
        preOpGas: bigint
        paid: bigint
    },
    gasLimits?: {
        callGasLimit?: bigint
        verificationGasLimit?: bigint
        paymasterVerificationGasLimit?: bigint
    }
) {
    const verificationGasLimit =
        gasLimits?.verificationGasLimit ??
        scaleBigIntByPercent(
            executionResult.preOpGas - userOp.preVerificationGas,
            150n
        )

    const calculatedCallGasLimit =
        gasLimits?.callGasLimit ??
        executionResult.paid / userOp.maxFeePerGas - executionResult.preOpGas

    let callGasLimit = maxBigInt(calculatedCallGasLimit, 9000n)

    if (isVersion06(userOp)) {
        callGasLimit += 21_000n + 50_000n
    }

    return {
        verificationGasLimit,
        callGasLimit,
        paymasterVerificationGasLimit:
            gasLimits?.paymasterVerificationGasLimit ?? 0n
    }
}

const getGasEstimates = async ({
    rpcHandler,
    userOp,
    entryPoint,
    stateOverrides,
    simulationGasLimit
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    stateOverrides?: StateOverrides
    simulationGasLimit?: bigint
}): Promise<GasEstimateResult> => {
    // Prepare userOperation for simulation.
    const {
        simulationVerificationGasLimit,
        simulationCallGasLimit,
        simulationPaymasterVerificationGasLimit,
        simulationPaymasterPostOpGasLimit,
        v6CallGasLimitMultiplier,
        v6VerificationGasLimitMultiplier,
        v7VerificationGasLimitMultiplier,
        v7PaymasterVerificationGasLimitMultiplier,
        v7CallGasLimitMultiplier,
        v7PaymasterPostOpGasLimitMultiplier,
        callGasLimitFloor
    } = rpcHandler.config

    // Create a deep mutable copy of stateOverrides to avoid modifying frozen objects
    let mutableStateOverrides: StateOverrides | undefined
    if (stateOverrides) {
        mutableStateOverrides = {}
        for (const [address, override] of Object.entries(stateOverrides)) {
            mutableStateOverrides[address as Address] = { ...override }
        }
    }

    // Get queued userOps.
    const queuedUserOps = await rpcHandler.mempool.getQueuedOutstandingUserOps({
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

    const simulationUserOp = {
        ...userOp,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        preVerificationGas: 0n,
        verificationGasLimit: simulationVerificationGasLimit,
        callGasLimit: simulationCallGasLimit
    }

    // Boosted userOperation must be simulated with maxFeePerGas/maxPriorityFeePerGas = 0.
    const isBoosted =
        userOp.maxFeePerGas === 0n && userOp.maxPriorityFeePerGas === 0n

    if (isBoosted) {
        const sender = userOp.sender
        if (mutableStateOverrides === undefined) {
            mutableStateOverrides = {}
        }

        // gas estimation simulation is done with maxFeePerGas/maxPriorityFeePerGas = 1.
        // Because of this, sender must have atleast maxGas of wei.
        const maxGas = parseEther("100000000")

        mutableStateOverrides[sender] = {
            ...deepHexlify(mutableStateOverrides[sender] || {}),
            balance: toHex(maxGas)
        }
    }

    if (isVersion07(simulationUserOp)) {
        simulationUserOp.paymasterVerificationGasLimit =
            simulationPaymasterVerificationGasLimit
        simulationUserOp.paymasterPostOpGasLimit =
            simulationPaymasterPostOpGasLimit
    }

    const executionResult = await rpcHandler.validator.getExecutionResult({
        userOp: simulationUserOp,
        queuedUserOps,
        entryPoint,
        stateOverrides: deepHexlify(mutableStateOverrides),
        gasLimit: simulationGasLimit
    })

    if (executionResult.result === "failed") {
        return {
            status: "failed",
            error: executionResult.data,
            code: executionResult.code
        }
    }

    // type cast as typescript doesn't know the type
    const successResult = executionResult

    let { verificationGasLimit, callGasLimit, paymasterVerificationGasLimit } =
        getVerificationGasAndCallGasLimit(
            simulationUserOp,
            successResult.data.executionResult,
            successResult.data
        )

    let paymasterPostOpGasLimit = 0n

    const hasPaymaster = isVersion07(userOp) && userOp.paymaster !== null
    const executionData = successResult.data.executionResult

    if (hasPaymaster) {
        if (
            !paymasterVerificationGasLimit &&
            "paymasterVerificationGasLimit" in executionData
        ) {
            paymasterVerificationGasLimit =
                executionData.paymasterVerificationGasLimit || 1n
        }

        if ("paymasterPostOpGasLimit" in executionData) {
            paymasterPostOpGasLimit =
                executionData.paymasterPostOpGasLimit || 1n
        }
    }

    if (simulationUserOp.callData === "0x") {
        callGasLimit = 0n
    }

    if (isVersion06(simulationUserOp)) {
        callGasLimit = scaleBigIntByPercent(
            callGasLimit,
            v6CallGasLimitMultiplier
        )
        verificationGasLimit = scaleBigIntByPercent(
            verificationGasLimit,
            v6VerificationGasLimitMultiplier
        )
    }

    if (isVersion07(simulationUserOp)) {
        verificationGasLimit = scaleBigIntByPercent(
            verificationGasLimit,
            v7VerificationGasLimitMultiplier
        )
        paymasterVerificationGasLimit = scaleBigIntByPercent(
            paymasterVerificationGasLimit,
            v7PaymasterVerificationGasLimitMultiplier
        )
        callGasLimit = scaleBigIntByPercent(
            callGasLimit,
            v7CallGasLimitMultiplier
        )
        paymasterPostOpGasLimit = scaleBigIntByPercent(
            paymasterPostOpGasLimit,
            v7PaymasterPostOpGasLimitMultiplier
        )
    }

    // If there are queued userOps, we need to add some buffer and floor as queued userOps
    // could have warmed up state.
    if (queuedUserOps.length > 0) {
        for (let i = 0; i < queuedUserOps.length; i++) {
            callGasLimit = scaleBigIntByPercent(
                callGasLimit,
                v7CallGasLimitMultiplier
            )
        }
        callGasLimit = maxBigInt(callGasLimit, callGasLimitFloor)
    }

    return {
        status: "success",
        estimates: {
            verificationGasLimit,
            callGasLimit,
            paymasterVerificationGasLimit,
            paymasterPostOpGasLimit
        },
        queuedUserOps
    }
}

const settleGasEstimates = async (
    estimates: Promise<GasEstimateResult>
): Promise<GasEstimateResult> => {
    try {
        return await estimates
    } catch (err) {
        return { status: "failed", error: String(err), cause: err }
    }
}

const fitsMaxGasPerUserOp = ({
    rpcHandler,
    userOp
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
}): boolean => {
    const gasFloor = calculateAA95GasFloor({
        userOps: [userOp],
        beneficiary: rpcHandler.config.utilityWalletAddress
    })

    return (
        scaleBigIntByPercent(
            gasFloor,
            rpcHandler.config.executorGasMultiplier
        ) <= rpcHandler.config.maxGasPerUserOp
    )
}

// Under EIP-8037, simulations capped at TX_MAX_GAS_LIMIT pay state gas from
// gas_left, so a userOp whose regular and state gas don't fit under the cap
// runs out of gas. Gas above the cap is the state gas reservoir, which
// gasleft() can't see, so simulating above it gives limits for regular gas
// only.
const needsReservoir = ({
    rpcHandler,
    userOp,
    meteredResult
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    meteredResult: GasEstimateResult
}): boolean => {
    const { supportsEip8037, fixedGasLimitForEstimation, chainType } =
        rpcHandler.config

    // A lower simulation cap is the operator's choice, not a sign of state gas
    const simulatesAtCap =
        fixedGasLimitForEstimation === undefined ||
        fixedGasLimitForEstimation >= TX_MAX_GAS_LIMIT

    if (!supportsEip8037 || !simulatesAtCap || chainType === "monad") {
        return false
    }

    if (meteredResult.status === "failed") {
        return (
            meteredResult.cause !== undefined ||
            meteredResult.code === ERC7769Errors.UserOperationReverted
        )
    }

    return !fitsMaxGasPerUserOp({
        rpcHandler,
        userOp: { ...userOp, ...meteredResult.estimates }
    })
}

export const ethEstimateUserOperationGasHandler = createMethodHandler({
    method: "eth_estimateUserOperationGas",
    schema: estimateUserOperationGasSchema,
    handler: async ({ rpcHandler, apiVersion, params }) => {
        const [userOp, entryPoint, stateOverrides] = params
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        // Extract all config values at the beginning
        const {
            v7PreVerificationGasLimitMultiplier,
            v6PreVerificationGasLimitMultiplier,
            chainType,
            maxReservoirGas
        } = rpcHandler.config

        // Validate userOp fields (sync - fail fast before async checks)
        const [fieldsValid, fieldsError] = rpcHandler.validateUserOpFields({
            userOp,
            entryPoint,
            isEstimation: true
        })
        if (!fieldsValid) {
            throw new RpcError(fieldsError, ERC7769Errors.InvalidFields)
        }

        // Execute multiple async operations in parallel
        const [
            [validEip7702Auth, validEip7702AuthError],
            meteredResult,
            l2PvgComponent,
            dynamicPvgComponent
        ] = await Promise.all([
            rpcHandler.validateEip7702Auth({
                userOp,
                validateSignature: false
            }),
            settleGasEstimates(
                getGasEstimates({
                    rpcHandler,
                    userOp,
                    entryPoint,
                    stateOverrides
                })
            ),
            getL2PvgComponent({
                config: rpcHandler.config,
                userOp,
                entryPoint,
                gasPriceManager: rpcHandler.gasPriceManager,
                validate: false
            }),
            getDynamicPvgComponent({
                userOp,
                entryPoint,
                config: rpcHandler.config
            })
        ])

        // Validate eip7702Auth
        if (!validEip7702Auth) {
            throw new RpcError(
                validEip7702AuthError,
                ERC7769Errors.InvalidFields
            )
        }

        let gasEstimateResult = meteredResult
        let reservoirSimulationGasLimit: bigint | undefined

        if (needsReservoir({ rpcHandler, userOp, meteredResult })) {
            const simulationGasLimit = TX_MAX_GAS_LIMIT + maxReservoirGas
            const reservoirResult = await settleGasEstimates(
                getGasEstimates({
                    rpcHandler,
                    userOp,
                    entryPoint,
                    stateOverrides,
                    simulationGasLimit
                })
            )

            if (reservoirResult.status === "success") {
                gasEstimateResult = reservoirResult
                reservoirSimulationGasLimit = simulationGasLimit
            }
        }

        // Validate gas estimation result first
        if (gasEstimateResult.status === "failed") {
            if (gasEstimateResult.cause !== undefined) {
                throw gasEstimateResult.cause
            }
            throw new RpcError(gasEstimateResult.error, gasEstimateResult.code)
        }

        // Now calculate execution gas component with the estimated gas values
        const userOpWithEstimatedGas = {
            ...userOp,
            ...gasEstimateResult.estimates
        }

        const basePvgComponent = getBasePvgComponent({
            userOp: userOpWithEstimatedGas,
            config: rpcHandler.config,
            dynamicPvgComponent
        })

        // Calculate total preVerificationGas by summing both components
        let preVerificationGas = basePvgComponent + l2PvgComponent

        // Add multipliers to pvg
        if (isVersion07(userOp)) {
            preVerificationGas = scaleBigIntByPercent(
                preVerificationGas,
                v7PreVerificationGasLimitMultiplier
            )
        }

        if (isVersion06(userOp)) {
            preVerificationGas = scaleBigIntByPercent(
                preVerificationGas,
                v6PreVerificationGasLimitMultiplier
            )
        }

        // In reservoir mode the limits only cover regular gas and the bundle
        // pays the state gas from a reservoir above TX_MAX_GAS_LIMIT. The
        // EntryPoint never charges reservoir gas to the userOp, so it goes in
        // preVerificationGas. Boosted userOps pay nothing, so the bundler
        // sizes their reservoir itself.
        if (reservoirSimulationGasLimit !== undefined) {
            const reservoirUserOp = {
                ...userOp,
                ...gasEstimateResult.estimates,
                preVerificationGas
            }

            if (!fitsMaxGasPerUserOp({ rpcHandler, userOp: reservoirUserOp })) {
                throw new RpcError(
                    `UserOperation needs more than ${rpcHandler.config.maxGasPerUserOp} gas excluding EIP-8037 state gas`,
                    ERC7769Errors.InvalidFields
                )
            }

            const isBoosted =
                userOp.maxFeePerGas === 0n && userOp.maxPriorityFeePerGas === 0n

            if (!isBoosted) {
                const reservoirGas =
                    await rpcHandler.validator.findReservoirGas({
                        userOp: reservoirUserOp,
                        queuedUserOps: gasEstimateResult.queuedUserOps,
                        entryPoint,
                        stateOverrides: deepHexlify(stateOverrides),
                        maxReservoirGas
                    })

                if (reservoirGas === undefined) {
                    throw new RpcError(
                        `UserOperation needs more than ${maxReservoirGas} EIP-8037 state gas`,
                        ERC7769Errors.UserOperationReverted
                    )
                }

                preVerificationGas += reservoirGas
                reservoirSimulationGasLimit = TX_MAX_GAS_LIMIT + reservoirGas
            }
        }

        const finalGasLimits = await rpcHandler.validator.validateHandleOp({
            userOp: {
                ...userOp,
                ...gasEstimateResult.estimates, // use actual callGasLimit, verificationGasLimit, paymasterPostOpGasLimit, paymasterVerificationGasLimit
                preVerificationGas
            },
            queuedUserOps: gasEstimateResult.queuedUserOps,
            entryPoint,
            stateOverrides: deepHexlify(stateOverrides),
            gasLimit: reservoirSimulationGasLimit
        })

        // Extrace values for returning
        const {
            verificationGasLimit,
            callGasLimit,
            paymasterVerificationGasLimit,
            paymasterPostOpGasLimit
        } = finalGasLimits

        if (chainType === "monad") {
            preVerificationGas = await getMonadPvg({
                config: rpcHandler.config,
                userOp: {
                    ...userOp,
                    ...finalGasLimits
                },
                entryPoint,
                validate: false
            })
        }

        if (isVersion07(userOp)) {
            return {
                preVerificationGas,
                verificationGasLimit,
                callGasLimit,
                paymasterVerificationGasLimit,
                paymasterPostOpGasLimit
            }
        }

        if (apiVersion === "v2") {
            return {
                preVerificationGas,
                verificationGasLimit,
                callGasLimit
            }
        }

        return {
            preVerificationGas,
            verificationGas: verificationGasLimit,
            verificationGasLimit,
            callGasLimit
        }
    }
})
