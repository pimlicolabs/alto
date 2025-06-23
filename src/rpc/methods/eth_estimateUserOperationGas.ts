import { scaleBigIntByPercent, maxBigInt } from "../../utils/bigInt"
import { isVersion06, isVersion07, deepHexlify } from "../../utils/userop"
import { calcPreVerificationGas } from "../../utils/validation"
import { createMethodHandler } from "../createMethodHandler"
import {
    Address,
    RpcError,
    StateOverrides,
    UserOperation,
    ValidationErrors,
    estimateUserOperationGasSchema
} from "@alto/types"
import { RpcHandler } from "../rpcHandler"
import { toHex } from "viem"

type GasEstimateResult =
    | {
          status: "success"
          estimates: {
              verificationGasLimit: bigint
              callGasLimit: bigint
              paymasterVerificationGasLimit: bigint
              paymasterPostOpGasLimit: bigint
          }
          queuedUserOperations: UserOperation[]
      }
    | {
          status: "failed"
          error: string
          code?: number
      }

function calcVerificationGasAndCallGasLimit(
    userOperation: UserOperation,
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
            executionResult.preOpGas - userOperation.preVerificationGas,
            150n
        )

    const calculatedCallGasLimit =
        gasLimits?.callGasLimit ??
        executionResult.paid / userOperation.maxFeePerGas -
            executionResult.preOpGas

    let callGasLimit = maxBigInt(calculatedCallGasLimit, 9000n)

    if (isVersion06(userOperation)) {
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
    userOperation,
    entryPoint,
    stateOverrides
}: {
    rpcHandler: RpcHandler
    userOperation: UserOperation
    entryPoint: Address
    stateOverrides?: StateOverrides
}): Promise<GasEstimateResult> => {
    // Create a deep mutable copy of stateOverrides to avoid modifying frozen objects
    let mutableStateOverrides: StateOverrides | undefined
    if (stateOverrides) {
        mutableStateOverrides = {}
        for (const [address, override] of Object.entries(stateOverrides)) {
            mutableStateOverrides[address as Address] = { ...override }
        }
    }

    // Get queued userOps.
    const queuedUserOperations =
        await rpcHandler.mempool.getQueuedOustandingUserOps({
            userOp: userOperation,
            entryPoint
        })

    // Prepare userOperation for simulation.
    const {
        simulationVerificationGasLimit,
        simulationCallGasLimit,
        simulationPaymasterVerificationGasLimit,
        simulationPaymasterPostOpGasLimit
    } = rpcHandler.config

    const simulationUserOp = {
        ...userOperation,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        preVerificationGas: 0n,
        verificationGasLimit: simulationVerificationGasLimit,
        callGasLimit: simulationCallGasLimit
    }

    // Boosted userOperation must be simulated with maxFeePerGas/maxPriorityFeePerGas = 0.
    const isBoosted =
        userOperation.maxFeePerGas === 0n &&
        userOperation.maxPriorityFeePerGas === 0n

    if (isBoosted) {
        const sender = userOperation.sender
        if (mutableStateOverrides === undefined) {
            mutableStateOverrides = {}
        }

        // gas estimation simulation is done with maxFeePerGas/maxPriorityFeePerGas = 1.
        // Because of this, sender must have atleast maxGas of wei.
        const maxGas =
            simulationCallGasLimit +
            simulationVerificationGasLimit +
            simulationPaymasterVerificationGasLimit +
            simulationPaymasterPostOpGasLimit

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
        userOperation: simulationUserOp,
        entryPoint,
        queuedUserOperations,
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
            rpcHandler.config.paymasterGasLimitMultiplier
        )
    }

    if (
        isVersion07(simulationUserOp) &&
        simulationUserOp.paymaster !== null &&
        "paymasterPostOpGasLimit" in successResult.data.executionResult
    ) {
        paymasterPostOpGasLimit =
            successResult.data.executionResult.paymasterPostOpGasLimit || 1n

        const userOperationPaymasterPostOpGasLimit =
            "paymasterPostOpGasLimit" in userOperation
                ? userOperation.paymasterPostOpGasLimit ?? 1n
                : 1n

        paymasterPostOpGasLimit = maxBigInt(
            userOperationPaymasterPostOpGasLimit,
            scaleBigIntByPercent(
                paymasterPostOpGasLimit,
                rpcHandler.config.paymasterGasLimitMultiplier
            )
        )
    }

    if (simulationUserOp.callData === "0x") {
        callGasLimit = 0n
    }

    if (isVersion06(simulationUserOp)) {
        callGasLimit = scaleBigIntByPercent(
            callGasLimit,
            rpcHandler.config.v6CallGasLimitMultiplier
        )
        verificationGasLimit = scaleBigIntByPercent(
            verificationGasLimit,
            rpcHandler.config.v6VerificationGasLimitMultiplier
        )
    }

    if (isVersion07(simulationUserOp)) {
        verificationGasLimit = scaleBigIntByPercent(
            verificationGasLimit,
            rpcHandler.config.v7VerificationGasLimitMultiplier
        )
        paymasterVerificationGasLimit = scaleBigIntByPercent(
            paymasterVerificationGasLimit,
            rpcHandler.config.v7PaymasterVerificationGasLimitMultiplier
        )
        callGasLimit = scaleBigIntByPercent(
            callGasLimit,
            rpcHandler.config.v7CallGasLimitMultiplier
        )
        paymasterPostOpGasLimit = scaleBigIntByPercent(
            paymasterPostOpGasLimit,
            rpcHandler.config.v7PaymasterPostOpGasLimitMultiplier
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
        queuedUserOperations
    }
}

export const ethEstimateUserOperationGasHandler = createMethodHandler({
    method: "eth_estimateUserOperationGas",
    schema: estimateUserOperationGasSchema,
    handler: async ({ rpcHandler, apiVersion, params }) => {
        const [userOperation, entryPoint, stateOverrides] = params
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        // Execute multiple async operations in parallel
        let [
            [validEip7702Auth, validEip7702AuthError],
            gasEstimateResult,
            preVerificationGas
        ] = await Promise.all([
            rpcHandler.validateEip7702Auth({
                userOperation
            }),
            getGasEstimates({
                rpcHandler,
                userOperation,
                entryPoint,
                stateOverrides
            }),
            calcPreVerificationGas({
                config: rpcHandler.config,
                userOperation,
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

        // Validate gas estimation result
        if (gasEstimateResult.status === "failed") {
            throw new RpcError(gasEstimateResult.error, gasEstimateResult.code)
        }

        // Add multipliers to pvg
        if (isVersion07(userOperation)) {
            preVerificationGas = scaleBigIntByPercent(
                preVerificationGas,
                rpcHandler.config.v7PreVerificationGasLimitMultiplier
            )
        }

        if (isVersion06(userOperation)) {
            preVerificationGas = scaleBigIntByPercent(
                preVerificationGas,
                rpcHandler.config.v6PreVerificationGasLimitMultiplier
            )
        }

        // Check if userOperation passes without estimation balance overrides (will throw error if it fails validation)
        await rpcHandler.validator.validateHandleOp({
            userOperation: {
                ...userOperation,
                ...gasEstimateResult.estimates, // use actual callGasLimit, verificationGasLimit, paymasterPostOpGasLimit, paymasterVerificationGasLimit
                preVerificationGas
            },
            entryPoint,
            queuedUserOperations: gasEstimateResult.queuedUserOperations,
            stateOverrides: deepHexlify(stateOverrides)
        })

        // Extrace values for returning
        const {
            verificationGasLimit,
            callGasLimit,
            paymasterVerificationGasLimit,
            paymasterPostOpGasLimit
        } = gasEstimateResult.estimates

        if (isVersion07(userOperation)) {
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
