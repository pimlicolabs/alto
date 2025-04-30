import { scaleBigIntByPercent, maxBigInt } from "../../utils/bigInt"
import {
    getNonceKeyAndSequence,
    isVersion06,
    isVersion07,
    deepHexlify
} from "../../utils/userop"
import {
    calcVerificationGasAndCallGasLimit,
    calcPreVerificationGas
} from "../../utils/validation"
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

const getUserOpGasEstimates = async ({
    rpcHandler,
    userOperation,
    entryPoint,
    stateOverrides
}: {
    rpcHandler: RpcHandler
    userOperation: UserOperation
    entryPoint: Address
    stateOverrides?: StateOverrides
}) => {
    // get queued userOps
    const queuedUserOperations =
        await rpcHandler.mempool.getQueuedOustandingUserOps({
            userOp: userOperation,
            entryPoint
        })

    // Prepare userOperation for simulation
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

    if (isVersion07(simulationUserOp)) {
        simulationUserOp.paymasterVerificationGasLimit =
            simulationPaymasterVerificationGasLimit
        simulationUserOp.paymasterPostOpGasLimit =
            simulationPaymasterPostOpGasLimit
    }

    // This is necessary because entryPoint pays
    // min(maxFeePerGas, baseFee + maxPriorityFeePerGas) for the verification
    // Since we don't want our estimations to depend upon baseFee, we set
    // maxFeePerGas to maxPriorityFeePerGas
    simulationUserOp.maxPriorityFeePerGas = simulationUserOp.maxFeePerGas

    const executionResult = await rpcHandler.validator.getExecutionResult({
        userOperation: simulationUserOp,
        entryPoint,
        queuedUserOperations,
        stateOverrides: deepHexlify(stateOverrides)
    })

    let { verificationGasLimit, callGasLimit, paymasterVerificationGasLimit } =
        calcVerificationGasAndCallGasLimit(
            simulationUserOp,
            executionResult.data.executionResult,
            executionResult.data
        )

    let paymasterPostOpGasLimit = 0n

    if (
        !paymasterVerificationGasLimit &&
        isVersion07(simulationUserOp) &&
        simulationUserOp.paymaster !== null &&
        "paymasterVerificationGasLimit" in executionResult.data.executionResult
    ) {
        paymasterVerificationGasLimit =
            executionResult.data.executionResult
                .paymasterVerificationGasLimit || 1n

        paymasterVerificationGasLimit = scaleBigIntByPercent(
            paymasterVerificationGasLimit,
            rpcHandler.config.paymasterGasLimitMultiplier
        )
    }

    if (
        isVersion07(simulationUserOp) &&
        simulationUserOp.paymaster !== null &&
        "paymasterPostOpGasLimit" in executionResult.data.executionResult
    ) {
        paymasterPostOpGasLimit =
            executionResult.data.executionResult.paymasterPostOpGasLimit || 1n

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
        const [
            [validEip7702Auth, validEip7702AuthError],
            currentNonceSeq,
            { queuedUserOperations, estimates }
        ] = await Promise.all([
            rpcHandler.validateEip7702Auth({
                userOperation
            }),
            rpcHandler.getNonceSeq(userOperation, entryPoint),
            getUserOpGasEstimates({
                rpcHandler,
                userOperation,
                entryPoint,
                stateOverrides
            })
        ])

        // Validate eip7702Auth
        if (!validEip7702Auth) {
            throw new RpcError(
                validEip7702AuthError,
                ValidationErrors.InvalidFields
            )
        }

        // Validate userOp.maxFeePerGas
        if (
            userOperation.maxFeePerGas === 0n &&
            !rpcHandler.config.isGasFreeChain
        ) {
            throw new RpcError(
                "user operation max fee per gas must be larger than 0 during gas estimation"
            )
        }

        // Nonce validation
        // If the nonce is less than the current nonce, the user operation has already been executed
        // If the nonce is greater than the current nonce, we may have missing user operations in the mempool
        const [, userOpNonceSeq] = getNonceKeyAndSequence(userOperation.nonce)
        if (userOpNonceSeq < currentNonceSeq) {
            throw new RpcError(
                "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                ValidationErrors.InvalidFields
            )
        }
        if (userOpNonceSeq > currentNonceSeq) {
            // Nonce queues are supported only for v7 user operations
            if (isVersion06(userOperation)) {
                throw new RpcError(
                    "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                    ValidationErrors.InvalidFields
                )
            }

            if (
                userOpNonceSeq >
                currentNonceSeq + BigInt(queuedUserOperations.length)
            ) {
                throw new RpcError(
                    "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                    ValidationErrors.InvalidFields
                )
            }
        }

        // Get PVG and validateUserOperation in parallel
        const [preVerificationGas, _validationResult] = await Promise.all([
            calcPreVerificationGas({
                config: rpcHandler.config,
                userOperation: {
                    ...userOperation,
                    ...estimates // use actual callGasLimit, verificationGasLimit, paymasterPostOpGasLimit, paymasterVerificationGasLimit
                },
                entryPoint,
                gasPriceManager: rpcHandler.gasPriceManager,
                validate: false
            }),
            // Check if userOperation passes without estimation balance overrides
            await rpcHandler.validator.validateHandleOp({
                userOperation: {
                    ...userOperation,
                    ...estimates, // use actual callGasLimit, verificationGasLimit, paymasterPostOpGasLimit, paymasterVerificationGasLimit
                    preVerificationGas: 0n // Skip PVG validation
                },
                entryPoint,
                queuedUserOperations,
                stateOverrides: deepHexlify(stateOverrides)
            })
        ])

        // Extrace values for returning
        const {
            verificationGasLimit,
            callGasLimit,
            paymasterVerificationGasLimit,
            paymasterPostOpGasLimit
        } = estimates

        if (isVersion07(userOperation)) {
            return {
                preVerificationGas: scaleBigIntByPercent(
                    preVerificationGas,
                    rpcHandler.config.v7PreVerificationGasLimitMultiplier
                ),
                verificationGasLimit,
                callGasLimit,
                paymasterVerificationGasLimit,
                paymasterPostOpGasLimit
            }
        }

        if (apiVersion === "v2") {
            return {
                preVerificationGas: scaleBigIntByPercent(
                    preVerificationGas,
                    rpcHandler.config.v6PreVerificationGasLimitMultiplier
                ),
                verificationGasLimit,
                callGasLimit
            }
        }

        return {
            preVerificationGas: scaleBigIntByPercent(
                preVerificationGas,
                rpcHandler.config.v6PreVerificationGasLimitMultiplier
            ),
            verificationGas: verificationGasLimit,
            verificationGasLimit,
            callGasLimit
        }
    }
})
