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
    RpcError,
    UserOperation,
    ValidationErrors,
    estimateUserOperationGasSchema
} from "@alto/types"

export const ethEstimateUserOperationGasHandler = createMethodHandler({
    method: "eth_estimateUserOperationGas",
    schema: estimateUserOperationGasSchema,
    handler: async ({ rpcHandler, apiVersion, params }) => {
        const [userOperation, entryPoint, stateOverrides] = params
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        if (userOperation.eip7702Auth) {
            await rpcHandler.validateEip7702Auth({
                userOperation
            })
        }

        if (
            userOperation.maxFeePerGas === 0n &&
            !rpcHandler.config.isGasFreeChain
        ) {
            throw new RpcError(
                "user operation max fee per gas must be larger than 0 during gas estimation"
            )
        }

        // Check if the nonce is valid
        // If the nonce is less than the current nonce, the user operation has already been executed
        // If the nonce is greater than the current nonce, we may have missing user operations in the mempool
        const currentNonceSeq = await rpcHandler.getNonceSeq(
            userOperation,
            entryPoint
        )
        const [, userOpNonceSeq] = getNonceKeyAndSequence(userOperation.nonce)

        let queuedUserOperations: UserOperation[] = []
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

            queuedUserOperations =
                await rpcHandler.mempool.getQueuedOustandingUserOps({
                    userOp: userOperation,
                    entryPoint
                })

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

        // Prepare userOperation for simulation
        const {
            simulationVerificationGasLimit,
            simulationCallGasLimit,
            simulationPaymasterVerificationGasLimit,
            simulationPaymasterPostOpGasLimit
        } = rpcHandler.config

        const simulationUserOperation = {
            ...userOperation,
            maxFeePerGas: 1n,
            maxPriorityFeePerGas: 1n,
            preVerificationGas: 0n,
            verificationGasLimit: simulationVerificationGasLimit,
            callGasLimit: simulationCallGasLimit
        }

        if (isVersion07(simulationUserOperation)) {
            simulationUserOperation.paymasterVerificationGasLimit =
                simulationPaymasterVerificationGasLimit
            simulationUserOperation.paymasterPostOpGasLimit =
                simulationPaymasterPostOpGasLimit
        }

        // This is necessary because entryPoint pays
        // min(maxFeePerGas, baseFee + maxPriorityFeePerGas) for the verification
        // Since we don't want our estimations to depend upon baseFee, we set
        // maxFeePerGas to maxPriorityFeePerGas
        simulationUserOperation.maxPriorityFeePerGas =
            simulationUserOperation.maxFeePerGas

        const executionResult = await rpcHandler.validator.getExecutionResult({
            userOperation: simulationUserOperation,
            entryPoint,
            queuedUserOperations,
            stateOverrides: deepHexlify(stateOverrides)
        })

        let {
            verificationGasLimit,
            callGasLimit,
            paymasterVerificationGasLimit
        } = calcVerificationGasAndCallGasLimit(
            simulationUserOperation,
            executionResult.data.executionResult,
            executionResult.data
        )

        let paymasterPostOpGasLimit = 0n

        if (
            !paymasterVerificationGasLimit &&
            isVersion07(simulationUserOperation) &&
            simulationUserOperation.paymaster !== null &&
            "paymasterVerificationGasLimit" in
                executionResult.data.executionResult
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
            isVersion07(simulationUserOperation) &&
            simulationUserOperation.paymaster !== null &&
            "paymasterPostOpGasLimit" in executionResult.data.executionResult
        ) {
            paymasterPostOpGasLimit =
                executionResult.data.executionResult.paymasterPostOpGasLimit ||
                1n

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

        if (simulationUserOperation.callData === "0x") {
            callGasLimit = 0n
        }

        if (isVersion06(simulationUserOperation)) {
            callGasLimit = scaleBigIntByPercent(
                callGasLimit,
                rpcHandler.config.v6CallGasLimitMultiplier
            )
            verificationGasLimit = scaleBigIntByPercent(
                verificationGasLimit,
                rpcHandler.config.v6VerificationGasLimitMultiplier
            )
        }

        if (isVersion07(simulationUserOperation)) {
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

        let preVerificationGas = await calcPreVerificationGas({
            config: rpcHandler.config,
            userOperation: {
                ...userOperation,
                callGasLimit, // use actual callGasLimit
                verificationGasLimit, // use actual verificationGasLimit
                paymasterPostOpGasLimit, // use actual paymasterPostOpGasLimit
                paymasterVerificationGasLimit // use actual paymasterVerificationGasLimit
            },
            entryPoint,
            gasPriceManager: rpcHandler.gasPriceManager,
            validate: false
        })
        preVerificationGas = scaleBigIntByPercent(preVerificationGas, 110n)

        // Check if userOperation passes without estimation balance overrides
        await rpcHandler.validator.validateHandleOp({
            userOperation: {
                ...userOperation,
                preVerificationGas,
                verificationGasLimit,
                callGasLimit,
                paymasterVerificationGasLimit,
                paymasterPostOpGasLimit
            },
            entryPoint,
            queuedUserOperations,
            stateOverrides: deepHexlify(stateOverrides)
        })

        if (isVersion07(simulationUserOperation)) {
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
