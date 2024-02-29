import type { Metrics } from "@alto/utils"
import {
    EntryPointAbi,
    ExecutionErrors,
    type ExecutionResult,
    RpcError,
    type UserOperation,
    ValidationErrors,
    executionResultSchema,
    hexDataSchema,
    EntryPointSimulationsAbi
} from "@entrypoint-0.6/types"
import type { StateOverrides } from "@entrypoint-0.6/types"
import type { Logger } from "@alto/utils"
import { deepHexlify } from "@entrypoint-0.6/utils"
import type { Chain, Hex, RpcRequestErrorType, Transport } from "viem"
import {
    type Address,
    type PublicClient,
    decodeErrorResult,
    encodeFunctionData,
    toHex,
    zeroAddress
} from "viem"
import { z } from "zod"
import {
    ExecuteSimulatorAbi,
    ExecuteSimulatorDeployedBytecode
} from "./ExecuteSimulator"

export async function simulateHandleOp(
    userOperation: UserOperation,
    entryPoint: Address,
    publicClient: PublicClient,
    replacedEntryPoint: boolean,
    targetAddress: Address,
    targetCallData: Hex,
    stateOverride?: StateOverrides
) {
    const finalParam = replacedEntryPoint
        ? {
              ...stateOverride,
              [userOperation.sender]: {
                  balance: toHex(100000_000000000000000000n),
                  ...(stateOverride
                      ? deepHexlify(stateOverride?.[userOperation.sender])
                      : [])
              },
              [entryPoint]: {
                  code: ExecuteSimulatorDeployedBytecode
              }
          }
        : {
              ...stateOverride,
              [userOperation.sender]: {
                  balance: toHex(100000_000000000000000000n),
                  ...(stateOverride
                      ? deepHexlify(stateOverride?.[userOperation.sender])
                      : [])
              }
          }

    try {
        await publicClient.request({
            method: "eth_call",
            // @ts-ignore
            params: [
                // @ts-ignore
                {
                    to: entryPoint,
                    data: encodeFunctionData({
                        abi: EntryPointAbi,
                        functionName: "simulateHandleOp",
                        args: [userOperation, targetAddress, targetCallData]
                    })
                },
                // @ts-ignore
                "latest",
                // @ts-ignore
                finalParam
            ]
        })
    } catch (e) {
        const err = e as RpcRequestErrorType

        const causeParseResult = z
            .object({
                code: z.literal(3),
                message: z.string().regex(/execution reverted.*/),
                data: hexDataSchema
            })
            .safeParse(err.cause)

        if (!causeParseResult.success) {
            throw new Error(JSON.stringify(err.cause))
        }

        const cause = causeParseResult.data

        const decodedError = decodeErrorResult({
            abi: [...EntryPointAbi, ...EntryPointSimulationsAbi],
            data: cause.data
        })

        if (
            decodedError &&
            decodedError.errorName === "FailedOp" &&
            decodedError.args
        ) {
            return { result: "failed", data: decodedError.args[1] } as const
        }

        if (
            decodedError &&
            decodedError.errorName === "Error" &&
            decodedError.args
        ) {
            return { result: "failed", data: decodedError.args[0] } as const
        }

        if (decodedError.errorName === "ExecutionResult") {
            const parsedExecutionResult = executionResultSchema.parse(
                decodedError.args
            )
            return { result: "execution", data: parsedExecutionResult } as const
        }
    }

    throw new Error("Unexpected error")
}

function tooLow(error: string) {
    return (
        error === "AA40 over verificationGasLimit" ||
        error === "AA41 too little verificationGas" ||
        error === "AA51 prefund below actualGasCost" ||
        error === "AA13 initCode failed or OOG" ||
        error === "AA21 didn't pay prefund" ||
        error === "AA23 reverted (or OOG)" ||
        error === "AA33 reverted (or OOG)" ||
        error === "return data out of bounds" ||
        error === "validation OOG"
    )
}

export async function estimateVerificationGasLimit(
    userOperation: UserOperation,
    entryPoint: Address,
    publicClient: PublicClient,
    logger: Logger,
    metrics: Metrics,
    stateOverrides?: StateOverrides
): Promise<bigint> {
    userOperation.callGasLimit = 0n

    let lower = 0n
    let upper = 10_000_000n
    let final: bigint | null = null

    const cutoff = 20_000n

    userOperation.verificationGasLimit = upper
    userOperation.callGasLimit = 0n

    let simulationCounter = 1
    const initial = await simulateHandleOp(
        userOperation,
        entryPoint,
        publicClient,
        false,
        zeroAddress,
        "0x",
        stateOverrides
    )

    if (initial.result === "execution") {
        upper = 6n * (initial.data.preOpGas - userOperation.preVerificationGas)
    } else {
        throw new RpcError(
            `UserOperation reverted during simulation with reason: ${initial.data}`,
            ValidationErrors.SimulateValidation
        )
    }

    // binary search
    while (upper - lower > cutoff) {
        const mid = (upper + lower) / 2n

        userOperation.verificationGasLimit = mid
        userOperation.callGasLimit = 0n

        const error = await simulateHandleOp(
            userOperation,
            entryPoint,
            publicClient,
            false,
            zeroAddress,
            "0x",
            stateOverrides
        )
        simulationCounter++

        if (error.result === "execution") {
            upper = mid
            final = mid
            logger.debug(`Verification gas limit: ${mid}`)
        } else if (tooLow(error.data)) {
            logger.debug(`Verification gas limit: ${mid}, error: ${error.data}`)
            lower = mid
        } else {
            logger.debug(`Verification gas limit: ${mid}, error: ${error.data}`)
            throw new Error("Unexpected error")
        }
    }

    if (final === null) {
        throw new RpcError("Failed to estimate verification gas limit")
    }

    if (userOperation.paymasterAndData === "0x") {
        final = final + 30_000n
    }

    logger.info(`Verification gas limit: ${final}`)

    metrics.verificationGasLimitEstimationCount.observe(simulationCounter)

    return final
}

function getCallExecuteResult(data: ExecutionResult) {
    const callExecuteResult = decodeErrorResult({
        abi: ExecuteSimulatorAbi,
        data: data.targetResult
    })

    const success = callExecuteResult.args[0]
    const revertData = callExecuteResult.args[1]
    const gasUsed = callExecuteResult.args[2]

    return {
        success,
        revertData,
        gasUsed
    }
}

export async function estimateCallGasLimit(
    userOperation: UserOperation,
    entryPoint: Address,
    publicClient: PublicClient<Transport, Chain>,
    logger: Logger,
    metrics: Metrics,
    stateOverrides?: StateOverrides
): Promise<bigint> {
    const targetCallData = encodeFunctionData({
        abi: ExecuteSimulatorAbi,
        functionName: "callExecute",
        args: [userOperation.sender, userOperation.callData, 2_000_000n]
    })

    userOperation.callGasLimit = 0n

    const error = await simulateHandleOp(
        userOperation,
        entryPoint,
        publicClient,
        true,
        entryPoint,
        targetCallData,
        stateOverrides
    )

    if (error.result === "failed") {
        throw new RpcError(
            `UserOperation reverted during simulation with reason: ${error.data}`,
            ExecutionErrors.UserOperationReverted
        )
    }

    const result = getCallExecuteResult(error.data)

    let lower = 0n
    let upper: bigint
    let final: bigint | null = null

    const cutoff = 10_000n

    if (result.success) {
        upper = 6n * result.gasUsed
        final = 6n * result.gasUsed
    } else {
        try {
            const reason = decodeErrorResult({
                abi: EntryPointSimulationsAbi,
                data: result.revertData
            })
            throw new RpcError(
                `UserOperation reverted during execution phase with reason: ${reason.args[0]}`,
                ExecutionErrors.UserOperationReverted
            )
        } catch (e) {
            if (e instanceof RpcError) throw e
            throw new RpcError(
                "UserOperation reverted during execution phase",
                ExecutionErrors.UserOperationReverted,
                result.revertData
            )
        }
    }

    // binary search
    while (upper - lower > cutoff) {
        const mid = (upper + lower) / 2n

        userOperation.callGasLimit = 0n
        const targetCallData = encodeFunctionData({
            abi: ExecuteSimulatorAbi,
            functionName: "callExecute",
            args: [userOperation.sender, userOperation.callData, mid]
        })

        const error = await simulateHandleOp(
            userOperation,
            entryPoint,
            publicClient,
            true,
            entryPoint,
            targetCallData,
            stateOverrides
        )

        if (error.result !== "execution") {
            throw new Error("Unexpected error")
        }

        const result = getCallExecuteResult(error.data)

        if (result.success) {
            upper = mid
            final = mid
            logger.debug(`Call gas limit: ${mid}`)
        } else {
            lower = mid
            logger.debug(`Call gas limit: ${mid}, error: ${result.revertData}`)
        }
    }

    if (final === null) {
        throw new RpcError("Failed to estimate call gas limit")
    }

    logger.info(`Call gas limit estimate: ${final}`)

    return final
}
