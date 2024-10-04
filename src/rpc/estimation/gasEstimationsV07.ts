import type { Hex } from "viem"
import {
    type Address,
    type PublicClient,
    decodeErrorResult,
    encodeFunctionData,
    toHex,
    decodeAbiParameters,
    decodeFunctionResult,
    toFunctionSelector,
    slice
} from "viem"
import {
    type StateOverrides,
    type UserOperationV07,
    type ValidationResultV07,
    type ExecutionResult,
    type TargetCallResult,
    EntryPointV07Abi,
    EntryPointV07SimulationsAbi,
    PimlicoEntryPointSimulationsAbi,
    ValidationErrors,
    ExecutionErrors,
    targetCallResultSchema
} from "@alto/types"
import { getUserOperationHash, toPackedUserOperation } from "@alto/utils"
import type { SimulateHandleOpResult } from "./gasEstimation"
import { AccountExecuteAbi } from "../../types/contracts/IAccountExecute"

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

function encodeUserOperationCalldata({
    op,
    entryPoint,
    chainId
}: {
    op: UserOperationV07
    entryPoint: Address
    chainId: number
}) {
    const packedOp = toPackedUserOperation(op)
    const executeUserOpMethodSig = toFunctionSelector(AccountExecuteAbi[0])

    const callDataMethodSig = slice(packedOp.callData, 0, 4)

    if (executeUserOpMethodSig === callDataMethodSig) {
        return encodeFunctionData({
            abi: AccountExecuteAbi,
            functionName: "executeUserOp",
            args: [packedOp, getUserOperationHash(op, entryPoint, chainId)]
        })
    }

    return packedOp.callData
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
      }
    | {
          result: "retry" // retry with new bounds if the initial simulation hit the eth_call gasLimit
          optimalGas: bigint
          maxGas: bigint
          minGas: bigint
      } {
    try {
        // check if the result is a SimulationOutOfGas error
        const simulationOutOfGasSelector = toFunctionSelector(
            "SimulationOutOfGas(uint256 optimalGas, uint256 minGas, uint256 maxGas)"
        )

        if (slice(data, 0, 4) === simulationOutOfGasSelector) {
            const res = decodeErrorResult({
                abi: EntryPointV07SimulationsAbi,
                data: data
            })

            if (res.errorName === "SimulationOutOfGas") {
                const [optimalGas, minGas, maxGas] = res.args

                return {
                    result: "retry",
                    optimalGas,
                    minGas,
                    maxGas
                } as const
            }
        }

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

export async function simulateHandleOpV07(
    userOperation: UserOperationV07,
    queuedUserOperations: UserOperationV07[],
    entryPoint: Address,
    publicClient: PublicClient,
    entryPointSimulationsAddress: Address,
    chainId: number,
    blockTagSupport: boolean,
    utilityWalletAddress: Address,
    finalParam: StateOverrides | undefined = undefined,
    fixedGasLimitForEstimation?: bigint
): Promise<SimulateHandleOpResult> {
    const userOperations = [...queuedUserOperations, userOperation]
    const packedUserOperations = userOperations.map((uop) => ({
        packedUserOperation: toPackedUserOperation(uop),
        userOperation: uop,
        userOperationHash: getUserOperationHash(uop, entryPoint, chainId)
    }))

    const simulateHandleOpCallData = encodeFunctionData({
        abi: EntryPointV07SimulationsAbi,
        functionName: "simulateHandleOpLast",
        args: [packedUserOperations.map((uop) => uop.packedUserOperation)]
    })

    const queuedOps = queuedUserOperations.map((op) => ({
        op: toPackedUserOperation(op),
        target: op.sender,
        targetCallData: encodeUserOperationCalldata({
            op,
            entryPoint,
            chainId
        })
    }))

    const targetOp = {
        op: toPackedUserOperation(userOperation),
        target: userOperation.sender,
        targetCallData: encodeUserOperationCalldata({
            op: userOperation,
            entryPoint,
            chainId
        })
    }

    const simulateTargetCallData = encodeFunctionData({
        abi: EntryPointV07SimulationsAbi,
        functionName: "simulateCallData",
        args: [queuedOps, targetOp, entryPoint, 0n, 1_000n, 1_000_000n]
    })

    const cause = await callPimlicoEntryPointSimulations(
        publicClient,
        entryPoint,
        [simulateHandleOpCallData, simulateTargetCallData],
        entryPointSimulationsAddress,
        blockTagSupport,
        utilityWalletAddress,
        finalParam,
        fixedGasLimitForEstimation
    )

    try {
        const [simulateHandleOpResult, simulateTargetCallDataResult] = cause

        const executionResult = getSimulateHandleOpResult(
            simulateHandleOpResult
        )

        if (executionResult.result === "failed") {
            return executionResult
        }

        const targetCallValidationResult = validateTargetCallDataResult(
            simulateTargetCallDataResult
        )

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
    } catch (e) {
        return {
            result: "failed",
            data: "Unknown error, could not parse simulate handle op result.",
            code: ValidationErrors.SimulateValidation
        }
    }
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

export async function callPimlicoEntryPointSimulations(
    publicClient: PublicClient,
    entryPoint: Address,
    entryPointSimulationsCallData: Hex[],
    entryPointSimulationsAddress: Address,
    blockTagSupport: boolean,
    utilityWalletAddress: Address,
    stateOverride?: StateOverrides,
    fixedGasLimitForEstimation?: bigint
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
                from: utilityWalletAddress,
                data: callData,
                ...(fixedGasLimitForEstimation !== undefined && {
                    gas: `0x${fixedGasLimitForEstimation.toString(16)}`
                })
            },
            blockTagSupport
                ? "latest"
                : toHex(await publicClient.getBlockNumber()),
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

export function getSimulateValidationResult(errorData: Hex): {
    status: "failed" | "validation"
    data: ValidationResultV07 | Hex | string
} {
    const decodedDelegateAndError = decodeErrorResult({
        abi: EntryPointV07Abi,
        data: errorData
    })

    if (!decodedDelegateAndError?.args?.[1]) {
        throw new Error("Unexpected error")
    }

    try {
        const decodedError = decodeErrorResult({
            abi: EntryPointV07SimulationsAbi,
            data: decodedDelegateAndError.args[1] as Hex
        })

        if (
            decodedError &&
            decodedError.errorName === "FailedOp" &&
            decodedError.args
        ) {
            return {
                status: "failed",
                data: decodedError.args[1] as Hex | string
            } as const
        }

        if (
            decodedError &&
            decodedError.errorName === "FailedOpWithRevert" &&
            decodedError.args
        ) {
            return {
                status: "failed",
                data: `${decodedError.args?.[1]} - ${parseFailedOpWithRevert(
                    decodedError.args?.[2] as Hex
                )}`
            } as const
        }
    } catch {
        const decodedResult = decodeAbiParameters(
            [
                {
                    components: [
                        {
                            components: [
                                {
                                    internalType: "uint256",
                                    name: "preOpGas",
                                    type: "uint256"
                                },
                                {
                                    internalType: "uint256",
                                    name: "prefund",
                                    type: "uint256"
                                },
                                {
                                    internalType: "uint256",
                                    name: "accountValidationData",
                                    type: "uint256"
                                },
                                {
                                    internalType: "uint256",
                                    name: "paymasterValidationData",
                                    type: "uint256"
                                },
                                {
                                    internalType: "bytes",
                                    name: "paymasterContext",
                                    type: "bytes"
                                }
                            ],
                            internalType: "struct IEntryPoint.ReturnInfo",
                            name: "returnInfo",
                            type: "tuple"
                        },
                        {
                            components: [
                                {
                                    internalType: "uint256",
                                    name: "stake",
                                    type: "uint256"
                                },
                                {
                                    internalType: "uint256",
                                    name: "unstakeDelaySec",
                                    type: "uint256"
                                }
                            ],
                            internalType: "struct IStakeManager.StakeInfo",
                            name: "senderInfo",
                            type: "tuple"
                        },
                        {
                            components: [
                                {
                                    internalType: "uint256",
                                    name: "stake",
                                    type: "uint256"
                                },
                                {
                                    internalType: "uint256",
                                    name: "unstakeDelaySec",
                                    type: "uint256"
                                }
                            ],
                            internalType: "struct IStakeManager.StakeInfo",
                            name: "factoryInfo",
                            type: "tuple"
                        },
                        {
                            components: [
                                {
                                    internalType: "uint256",
                                    name: "stake",
                                    type: "uint256"
                                },
                                {
                                    internalType: "uint256",
                                    name: "unstakeDelaySec",
                                    type: "uint256"
                                }
                            ],
                            internalType: "struct IStakeManager.StakeInfo",
                            name: "paymasterInfo",
                            type: "tuple"
                        },
                        {
                            components: [
                                {
                                    internalType: "address",
                                    name: "aggregator",
                                    type: "address"
                                },
                                {
                                    components: [
                                        {
                                            internalType: "uint256",
                                            name: "stake",
                                            type: "uint256"
                                        },
                                        {
                                            internalType: "uint256",
                                            name: "unstakeDelaySec",
                                            type: "uint256"
                                        }
                                    ],
                                    internalType:
                                        "struct IStakeManager.StakeInfo",
                                    name: "stakeInfo",
                                    type: "tuple"
                                }
                            ],
                            internalType:
                                "struct IEntryPoint.AggregatorStakeInfo",
                            name: "aggregatorInfo",
                            type: "tuple"
                        }
                    ],
                    internalType:
                        "struct IEntryPointSimulations.ValidationResult",
                    name: "",
                    type: "tuple"
                }
            ],
            decodedDelegateAndError.args[1] as Hex
        )[0]

        return {
            status: "validation",
            data: decodedResult
        }
    }

    throw new Error(
        "Unexpected error - errorName is not ValidationResult or ValidationResultWithAggregation"
    )
}

export async function simulateValidation(
    userOperation: UserOperationV07,
    queuedUserOperations: UserOperationV07[],
    entryPoint: Address,
    publicClient: PublicClient,
    entryPointSimulationsAddress: Address,
    blockTagSupport: boolean,
    utilityWalletAddress: Address
) {
    const userOperations = [...queuedUserOperations, userOperation]
    const packedUserOperations = userOperations.map((uo) =>
        toPackedUserOperation(uo)
    )

    const entryPointSimulationsCallData = encodeFunctionData({
        abi: EntryPointV07SimulationsAbi,
        functionName: "simulateValidationLast",
        args: [packedUserOperations]
    })

    const errorResult = await callPimlicoEntryPointSimulations(
        publicClient,
        entryPoint,
        [entryPointSimulationsCallData],
        entryPointSimulationsAddress,
        blockTagSupport,
        utilityWalletAddress
    )

    return {
        simulateValidationResult: getSimulateValidationResult(errorResult[0])
    }
}
