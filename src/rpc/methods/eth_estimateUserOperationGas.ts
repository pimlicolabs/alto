import {
    type Address,
    RpcError,
    type StateOverrides,
    type UserOperation,
    ValidationErrors,
    estimateUserOperationGasSchema
} from "@alto/types"
import { parseEther, toHex } from "viem"
import { maxBigInt, scaleBigIntByPercent } from "../../utils/bigInt"
import {
    calcExecutionPvgComponent,
    calcL2PvgComponent
} from "../../utils/preVerificationGasCalulator"
import { deepHexlify, isVersion06, isVersion07 } from "../../utils/userop"
import { createMethodHandler } from "../createMethodHandler"
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
      }

function calcVerificationGasAndCallGasLimit(
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
    stateOverrides
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    stateOverrides?: StateOverrides
}): Promise<GasEstimateResult> => {
    // Prepare userOperation for simulation.
    const {
        simulationVerificationGasLimit,
        simulationCallGasLimit,
        simulationPaymasterVerificationGasLimit,
        simulationPaymasterPostOpGasLimit,
        paymasterGasLimitMultiplier,
        v6CallGasLimitMultiplier,
        v6VerificationGasLimitMultiplier,
        v7VerificationGasLimitMultiplier,
        v7PaymasterVerificationGasLimitMultiplier,
        v7CallGasLimitMultiplier,
        v7PaymasterPostOpGasLimitMultiplier
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
        const maxGas = parseEther("100")

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
        stateOverrides: deepHexlify(mutableStateOverrides)
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
        calcVerificationGasAndCallGasLimit(
            simulationUserOp,
            successResult.data.executionResult,
            successResult.data
        )

    let paymasterPostOpGasLimit = 0n

    if (
        !paymasterVerificationGasLimit &&
        isVersion07(simulationUserOp) &&
        simulationUserOp.paymaster !== null &&
        "paymasterVerificationGasLimit" in successResult.data.executionResult
    ) {
        paymasterVerificationGasLimit =
            successResult.data.executionResult.paymasterVerificationGasLimit ||
            1n

        paymasterVerificationGasLimit = scaleBigIntByPercent(
            paymasterVerificationGasLimit,
            paymasterGasLimitMultiplier
        )
    }

    if (
        isVersion07(simulationUserOp) &&
        simulationUserOp.paymaster !== null &&
        "paymasterPostOpGasLimit" in successResult.data.executionResult
    ) {
        paymasterPostOpGasLimit =
            successResult.data.executionResult.paymasterPostOpGasLimit || 1n

        const userOpPaymasterPostOpGasLimit =
            "paymasterPostOpGasLimit" in userOp
                ? (userOp.paymasterPostOpGasLimit ?? 1n)
                : 1n

        paymasterPostOpGasLimit = maxBigInt(
            userOpPaymasterPostOpGasLimit,
            scaleBigIntByPercent(
                paymasterPostOpGasLimit,
                paymasterGasLimitMultiplier
            )
        )
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

export const ethEstimateUserOperationGasHandler = createMethodHandler({
    method: "eth_estimateUserOperationGas",
    schema: estimateUserOperationGasSchema,
    handler: async ({ rpcHandler, apiVersion, params }) => {
        const [userOp, entryPoint, stateOverrides] = params
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        // Extract all config values at the beginning
        const {
            supportsEip7623,
            v7PreVerificationGasLimitMultiplier,
            v6PreVerificationGasLimitMultiplier
        } = rpcHandler.config

        // Execute multiple async operations in parallel
        const [
            [validEip7702Auth, validEip7702AuthError],
            gasEstimateResult,
            l2GasComponent
        ] = await Promise.all([
            rpcHandler.validateEip7702Auth({
                userOp
            }),
            getGasEstimates({
                rpcHandler,
                userOp,
                entryPoint,
                stateOverrides
            }),
            calcL2PvgComponent({
                config: rpcHandler.config,
                userOp,
                entryPoint,
                gasPriceManager: rpcHandler.gasPriceManager,
                validate: false
            })
        ])

        // Validate eip7702Auth
        if (!validEip7702Auth) {
            throw new RpcError(
                validEip7702AuthError,
                ValidationErrors.InvalidFields
            )
        }

        // Validate gas estimation result first
        if (gasEstimateResult.status === "failed") {
            throw new RpcError(gasEstimateResult.error, gasEstimateResult.code)
        }

        // Now calculate execution gas component with the estimated gas values
        const userOpWithEstimatedGas = {
            ...userOp,
            ...gasEstimateResult.estimates
        }

        const executionGasComponent = calcExecutionPvgComponent({
            userOp: userOpWithEstimatedGas,
            supportsEip7623,
            config: rpcHandler.config
        })

        // Calculate total preVerificationGas by summing both components
        let preVerificationGas = executionGasComponent + l2GasComponent

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

        const finalGasLimits = await rpcHandler.validator.validateHandleOp({
            userOp: {
                ...userOp,
                ...gasEstimateResult.estimates, // use actual callGasLimit, verificationGasLimit, paymasterPostOpGasLimit, paymasterVerificationGasLimit
                preVerificationGas
            },
            queuedUserOps: gasEstimateResult.queuedUserOps,
            entryPoint,
            stateOverrides: deepHexlify(stateOverrides)
        })

        // Extrace values for returning
        const {
            verificationGasLimit,
            callGasLimit,
            paymasterVerificationGasLimit,
            paymasterPostOpGasLimit
        } = finalGasLimits

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
