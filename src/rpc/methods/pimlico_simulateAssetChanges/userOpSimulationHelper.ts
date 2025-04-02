import { Logger } from "pino"
import { Hex, decodeAbiParameters, encodeFunctionData, Address } from "viem"
import { ExecutionErrors, RpcError } from "../../../types/utils"
import { ValidationErrors } from "../../../types/utils"
import {
    decodeDelegateAndRevertResponse,
    getSimulateHandleOpResult
} from "../../estimation/gasEstimationsV07"
import {
    PimlicoEntryPointSimulationsAbi,
    EntryPointV07SimulationsAbi
} from "../../../types/contracts"
import { UserOperationV07 } from "../../../types/schemas"
import { toPackedUserOperation } from "../../../utils/userop"
import { ReadonlyDeep } from "type-fest"

export function getSimulateHandleOpCallData({
    userOperation,
    entryPoint
}: { userOperation: ReadonlyDeep<UserOperationV07>; entryPoint: Address }) {
    const userOp = {
        ...userOperation
    }

    // Set gasLimits for simulation
    userOp.callGasLimit = 15_000_000n
    userOp.verificationGasLimit = 10_000_000n
    userOp.paymasterPostOpGasLimit = 1_000_000n
    userOp.paymasterVerificationGasLimit = 1_000_000n

    // Set zero gasLimits to skip prefund checks
    userOp.maxFeePerGas = 0n
    userOp.maxPriorityFeePerGas = 0n

    const callData = encodeFunctionData({
        abi: PimlicoEntryPointSimulationsAbi,
        functionName: "simulateEntryPoint",
        args: [
            entryPoint,
            [
                encodeFunctionData({
                    abi: EntryPointV07SimulationsAbi,
                    functionName: "simulateHandleOp",
                    args: [toPackedUserOperation(userOp)]
                })
            ]
        ]
    })

    return callData
}

export function validateSimulateHandleOpResult({
    data,
    logger
}: { data: Hex; logger: Logger }) {
    try {
        const [result] = decodeAbiParameters(
            [{ name: "ret", type: "bytes[]" }],
            data
        )

        const simulateHandleOpResult = result[0]

        const delegateAndRevertResponse = decodeDelegateAndRevertResponse(
            simulateHandleOpResult
        )

        const simulationResult = getSimulateHandleOpResult(
            delegateAndRevertResponse
        )

        // If execution failed, bubble up error.
        if (simulationResult.result === "failed") {
            const { data } = simulationResult
            let errorCode: number = ExecutionErrors.UserOperationReverted

            if (data.toString().includes("AA23")) {
                errorCode = ValidationErrors.SimulateValidation
            }

            throw new RpcError(
                `UserOperation reverted during simulation with reason: ${data}`,
                errorCode
            )
        }
    } catch (err) {
        logger.error({ err }, "Failed to decode simulation result")
        throw new RpcError(
            "Failed to decode simulation result",
            ValidationErrors.SimulateValidation
        )
    }
}
