import type { Metrics } from "@alto/utils"
import {
    EntryPointV06Abi,
    ExecutionErrors,
    type ExecutionResult,
    RpcError,
    type UserOperation,
    ValidationErrors,
    executionResultSchema,
    hexDataSchema,
    EntryPointV06SimulationsAbi,
    EntryPointV07SimulationsAbi,
    EntryPointV07Abi,
    targetCallResultSchema
} from "@alto/types"
import type {
    StateOverrides,
    TargetCallResult,
    UserOperationV06,
    UserOperationV07
} from "@alto/types"
import type { Logger } from "@alto/utils"
import { deepHexlify, isVersion06, toPackedUserOperation } from "@alto/utils"
import type { Chain, Hex, RpcRequestErrorType, Transport } from "viem"
import {
    type Address,
    type PublicClient,
    decodeErrorResult,
    encodeFunctionData,
    toHex,
    zeroAddress,
    decodeAbiParameters,
    decodeFunctionResult
} from "viem"
import { z } from "zod"
import {
    ExecuteSimulatorAbi,
    ExecuteSimulatorDeployedBytecode
} from "./ExecuteSimulator"
import { PimlicoEntryPointSimulationsAbi } from "@alto/types"

function getStateOverrides({
    userOperation,
    entryPoint,
    replacedEntryPoint,
    stateOverride = {}
}: {
    entryPoint: Address
    replacedEntryPoint: boolean
    stateOverride: StateOverrides
    userOperation: UserOperation
}) {
    return replacedEntryPoint
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
}

export async function simulateHandleOpV06(
    userOperation: UserOperationV06,
    entryPoint: Address,
    publicClient: PublicClient,
    targetAddress: Address,
    targetCallData: Hex,
    finalParam: StateOverrides | undefined = undefined
): Promise<SimulateHandleOpResult> {
    try {
        await publicClient.request({
            method: "eth_call",
            // @ts-ignore
            params: [
                // @ts-ignore
                {
                    to: entryPoint,
                    data: encodeFunctionData({
                        abi: EntryPointV06Abi,
                        functionName: "simulateHandleOp",
                        args: [userOperation, targetAddress, targetCallData]
                    })
                },
                // @ts-ignore
                "latest",
                // @ts-ignore
                ...(finalParam ? [finalParam] : [])
            ]
        })
    } catch (e) {
        const err = e as RpcRequestErrorType

        const causeParseResult = z
            .union([
                z.object({
                    code: z.literal(3),
                    message: z.string().regex(/execution reverted.*/),
                    data: hexDataSchema
                }),
                /* fuse rpcs return weird values, this accounts for that. */
                z.object({
                    code: z.number(),
                    message: z.string().regex(/VM execution error.*/),
                    data: z
                        .string()
                        .transform((data) => data.replace("Reverted ", ""))
                        .pipe(hexDataSchema)
                })
            ])
            .safeParse(err.cause)

        if (!causeParseResult.success) {
            throw new Error(JSON.stringify(err.cause))
        }

        const cause = causeParseResult.data

        const decodedError = decodeErrorResult({
            abi: [...EntryPointV06Abi, ...EntryPointV06SimulationsAbi],
            data: cause.data
        })

        if (
            decodedError &&
            decodedError.errorName === "FailedOp" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: decodedError.args[1] as string
            } as const
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
            return {
                result: "execution",
                data: {
                    executionResult: parsedExecutionResult
                } as const
            }
        }
    }
    throw new Error("Unexpected error")
}

async function callPimlicoEntryPointSimulations(
    publicClient: PublicClient,
    entryPoint: Address,
    entryPointSimulationsCallData: Hex[],
    entryPointSimulationsAddress: Address,
    stateOverride?: StateOverrides
) {
    const callData = encodeFunctionData({
        abi: PimlicoEntryPointSimulationsAbi,
        functionName: "simulateEntryPoint",
        args: [entryPoint, entryPointSimulationsCallData]
    })

    const result = (await publicClient.request({
        method: "eth_call",
        params: [
            {
                to: entryPointSimulationsAddress,
                data: callData
            },
            "latest",
            // @ts-ignore
            ...(stateOverride ? [stateOverride] : [])
        ]
    })) as Hex

    const returnBytes = decodeAbiParameters(
        [{ name: "ret", type: "bytes[]" }],
        result
    )

    return returnBytes[0].map((data: Hex) => {
        const decodedDelegateAndError = decodeErrorResult({
            abi: EntryPointV07Abi,
            data: data
        })

        if (!decodedDelegateAndError?.args?.[1]) {
            throw new Error("Unexpected error")
        }
        return decodedDelegateAndError.args[1] as Hex
    })
}

const panicCodes: { [key: number]: string } = {
    // from https://docs.soliditylang.org/en/v0.8.0/control-structures.html
    1: "assert(false)",
    17: "arithmetic overflow/underflow",
    18: "divide by zero",
    33: "invalid enum value",
    34: "storage byte array that is incorrectly encoded",
    49: ".pop() on an empty array.",
    50: "array sout-of-bounds or negative index",
    65: "memory overflow",
    81: "zero-initialized variable of internal function type"
}

export function parseFailedOpWithRevert(data: Hex) {
    const methodSig = data.slice(0, 10)
    const dataParams = `0x${data.slice(10)}` as Hex

    if (methodSig === "0x08c379a0") {
        const [err] = decodeAbiParameters(
            [
                {
                    name: "err",
                    type: "string"
                }
            ],
            dataParams
        )

        return err
    }

    if (methodSig === "0x4e487b71") {
        const [code] = decodeAbiParameters(
            [
                {
                    name: "err",
                    type: "uint256"
                }
            ],
            dataParams
        )

        return panicCodes[Number(code)] ?? `${code}`
    }

    return data
}

function validateTargetCallDataResult(data: Hex):
    | {
          result: "success"
          data: TargetCallResult
      }
    | {
          result: "failed"
          data: string
          code: number
      } {
    try {
        const targetCallResult = decodeFunctionResult({
            abi: EntryPointV07SimulationsAbi,
            functionName: "simulateCallData",
            data: data
        })

        const parsedTargetCallResult =
            targetCallResultSchema.parse(targetCallResult)

        if (parsedTargetCallResult.success) {
            return {
                result: "success",
                data: parsedTargetCallResult
            } as const
        }

        return {
            result: "failed",
            data: parsedTargetCallResult.returnData,
            code: ExecutionErrors.UserOperationReverted
        } as const
    } catch (_e) {
        // no error we go the result
        return {
            result: "failed",
            data: "Unknown error, could not parse target call data result.",
            code: ExecutionErrors.UserOperationReverted
        } as const
    }
}

function getSimulateHandleOpResult(data: Hex): SimulateHandleOpResult {
    try {
        const decodedError = decodeErrorResult({
            abi: EntryPointV07SimulationsAbi,
            data: data
        })

        if (
            decodedError &&
            decodedError.errorName === "FailedOp" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: decodedError.args[1] as string,
                code: ValidationErrors.SimulateValidation
            } as const
        }

        if (
            decodedError &&
            decodedError.errorName === "FailedOpWithRevert" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: parseFailedOpWithRevert(decodedError.args?.[2] as Hex),
                code: ValidationErrors.SimulateValidation
            } as const
        }
    } catch {
        // no error we go the result
        const decodedResult: ExecutionResult = decodeFunctionResult({
            abi: EntryPointV07SimulationsAbi,
            functionName: "simulateHandleOp",
            data
        }) as unknown as ExecutionResult

        return {
            result: "execution",
            data: {
                executionResult: decodedResult
            } as const
        }
    }
    throw new Error("Unexpected error")
}

export async function simulateHandleOpV07(
    userOperation: UserOperationV07,
    entryPoint: Address,
    publicClient: PublicClient,
    targetAddress: Address,
    targetCallData: Hex,
    entryPointSimulationsAddress: Address,
    finalParam: StateOverrides | undefined = undefined
): Promise<SimulateHandleOpResult> {
    const packedUserOperation = toPackedUserOperation(userOperation)

    const entryPointSimulationsSimulateHandleOpCallData = encodeFunctionData({
        abi: EntryPointV07SimulationsAbi,
        functionName: "simulateHandleOp",
        args: [packedUserOperation]
    })

    const entryPointSimulationsSimulateTargetCallData = encodeFunctionData({
        abi: EntryPointV07SimulationsAbi,
        functionName: "simulateCallData",
        args: [packedUserOperation, targetAddress, targetCallData]
    })

    const cause = await callPimlicoEntryPointSimulations(
        publicClient,
        entryPoint,
        [
            entryPointSimulationsSimulateHandleOpCallData,
            entryPointSimulationsSimulateTargetCallData
        ],
        entryPointSimulationsAddress,
        finalParam
    )

    const executionResult = getSimulateHandleOpResult(cause[0])

    if (executionResult.result === "failed") {
        return executionResult
    }

    const targetCallValidationResult = validateTargetCallDataResult(cause[1])

    if (targetCallValidationResult.result === "failed") {
        return targetCallValidationResult
    }

    return {
        result: "execution",
        data: {
            callDataResult: targetCallValidationResult.data,
            executionResult: (
                executionResult as SimulateHandleOpResult<"execution">
            ).data.executionResult
        }
    }
}

export type SimulateHandleOpResult<
    TypeResult extends "failed" | "execution" = "failed" | "execution"
> = {
    result: TypeResult
    data: TypeResult extends "failed"
        ? string
        : {
              callDataResult?: TargetCallResult
              executionResult: ExecutionResult
          }
    code?: TypeResult extends "failed" ? number : undefined
}

export function simulateHandleOp(
    userOperation: UserOperation,
    entryPoint: Address,
    publicClient: PublicClient,
    replacedEntryPoint: boolean,
    targetAddress: Address,
    targetCallData: Hex,
    balanceOverrideEnabled: boolean,
    stateOverride: StateOverrides = {},
    entryPointSimulationsAddress?: Address
): Promise<SimulateHandleOpResult> {
    let finalStateOverride = undefined

    if (balanceOverrideEnabled) {
        finalStateOverride = getStateOverrides({
            userOperation,
            entryPoint,
            replacedEntryPoint,
            stateOverride
        })
    }

    if (isVersion06(userOperation)) {
        return simulateHandleOpV06(
            userOperation,
            entryPoint,
            publicClient,
            targetAddress,
            targetCallData,
            finalStateOverride
        )
    }

    if (!entryPointSimulationsAddress) {
        throw new RpcError(
            "entryPointSimulationsAddress must be provided for V07 UserOperation",
            ValidationErrors.InvalidFields
        )
    }

    return simulateHandleOpV07(
        userOperation,
        entryPoint,
        publicClient,
        userOperation.sender,
        userOperation.callData,
        entryPointSimulationsAddress,
        finalStateOverride
    )
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
    userOperation: UserOperationV06,
    entryPoint: Address,
    publicClient: PublicClient,
    logger: Logger,
    metrics: Metrics,
    balanceOverrideEnabled: boolean,
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
        balanceOverrideEnabled,
        stateOverrides
    )

    if (initial.result === "execution") {
        const simulationResult = initial as SimulateHandleOpResult<"execution">
        upper =
            6n *
            (simulationResult.data.executionResult.preOpGas -
                userOperation.preVerificationGas)
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
            balanceOverrideEnabled,
            stateOverrides
        )
        simulationCounter++

        if (error.result === "execution") {
            upper = mid
            final = mid
            logger.debug(`Verification gas limit: ${mid}`)
        } else if (tooLow(error.data as string)) {
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
        final += 30_000n
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
    balanceOverrideEnabled: boolean,
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
        balanceOverrideEnabled,
        stateOverrides
    )

    if (error.result === "failed") {
        throw new RpcError(
            `UserOperation reverted during simulation with reason: ${error.data}`,
            ExecutionErrors.UserOperationReverted
        )
    }

    const result = getCallExecuteResult(
        (error as SimulateHandleOpResult<"execution">).data.executionResult
    )

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
                abi: EntryPointV06SimulationsAbi,
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
            balanceOverrideEnabled,
            stateOverrides
        )

        if (error.result !== "execution") {
            throw new Error("Unexpected error")
        }

        const result = getCallExecuteResult(
            (error as SimulateHandleOpResult<"execution">).data.executionResult
        )

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
