import {
    EntryPointAbi,
    hexDataSchema,
    EntryPointSimulationsAbi,
    PimlicoEntryPointSimulationsAbi,
    PimlicoEntryPointSimulationsBytecode,
    ValidationErrors,
    ExecutionErrors
} from "@entrypoint-0.7/types"
import type {
    StateOverrides,
    UnPackedUserOperation,
    ValidationResult
} from "@entrypoint-0.7/types"
import { deepHexlify, toPackedUserOperation } from "@entrypoint-0.7/utils"
import type { Hex, RpcRequestErrorType } from "viem"
import {
    type Address,
    type PublicClient,
    decodeErrorResult,
    encodeFunctionData,
    toHex,
    decodeAbiParameters,
    encodeDeployData
} from "viem"
import { z } from "zod"
import { ExecuteSimulatorDeployedBytecode } from "./ExecuteSimulator"

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

function getStateOverrides({
    userOperation,
    entryPoint,
    replacedEntryPoint,
    stateOverride = {}
}: {
    entryPoint: Address
    replacedEntryPoint: boolean
    stateOverride: StateOverrides
    userOperation: UnPackedUserOperation
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

function getSimulateHandleOpResult(data: Hex) {
    const decodedDelegateAndError = decodeErrorResult({
        abi: EntryPointAbi,
        data: data
    })

    if (!decodedDelegateAndError?.args?.[1]) {
        throw new Error("Unexpected error")
    }

    try {
        const decodedError = decodeErrorResult({
            abi: EntryPointSimulationsAbi,
            data: decodedDelegateAndError.args[1] as Hex
        })

        if (
            decodedError &&
            decodedError.errorName === "FailedOp" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: decodedError.args[1],
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
        const decodedResult = decodeAbiParameters(
            [
                {
                    components: [
                        {
                            internalType: "uint256",
                            name: "preOpGas",
                            type: "uint256"
                        },
                        {
                            internalType: "uint256",
                            name: "paid",
                            type: "uint256"
                        },
                        {
                            internalType: "uint256",
                            name: "validationData",
                            type: "uint256"
                        },
                        {
                            internalType: "uint256",
                            name: "paymasterValidationData",
                            type: "uint256"
                        },
                        {
                            internalType: "bool",
                            name: "targetSuccess",
                            type: "bool"
                        },
                        {
                            internalType: "bytes",
                            name: "targetResult",
                            type: "bytes"
                        }
                    ],
                    internalType:
                        "struct IEntryPointSimulations.ExecutionResult",
                    name: "",
                    type: "tuple"
                }
            ],
            decodedDelegateAndError.args[1] as Hex
        )[0]

        return {
            result: "execution",
            data: decodedResult
        } as const
    }
    throw new Error("Unexpected error")
}

function callPimlicoEntryPointSimulations(
    publicClient: PublicClient,
    calldata: Hex,
    stateOverride?: StateOverrides
) {
    return publicClient
        .request({
            method: "eth_call",
            params: [
                {
                    data: calldata
                },
                "latest",
                // @ts-ignore
                stateOverride
            ]
        })
        .catch((e) => {
            const rpcRequestError = e as RpcRequestErrorType

            if (!rpcRequestError) {
                throw new Error("Unexpected error")
            }

            const causeParseResult = z
                .object({
                    code: z.literal(3),
                    message: z.string().regex(/execution reverted.*/),
                    data: hexDataSchema
                })
                .safeParse(rpcRequestError.cause)

            if (!causeParseResult.success) {
                throw new Error(JSON.stringify(rpcRequestError.cause))
            }

            return causeParseResult.data
        }) as Promise<{
        data: `0x${string}`
        code: 3
        message: string
    }>
}

export async function simulateHandleOp(
    userOperation: UnPackedUserOperation,
    entryPoint: Address,
    publicClient: PublicClient,
    replacedEntryPoint: boolean,
    targetAddress: Address,
    targetCallData: Hex,
    stateOverride: StateOverrides = {}
) {
    const finalParam = getStateOverrides({
        userOperation,
        entryPoint,
        replacedEntryPoint,
        stateOverride
    })

    const packedUserOperation = toPackedUserOperation(userOperation)

    const entryPointSimulationsCallData = encodeFunctionData({
        abi: EntryPointSimulationsAbi,
        functionName: "simulateHandleOp",
        args: [packedUserOperation, targetAddress, targetCallData]
    })

    const calldata = encodeDeployData({
        abi: PimlicoEntryPointSimulationsAbi,
        bytecode: PimlicoEntryPointSimulationsBytecode,
        args: [entryPoint, entryPointSimulationsCallData]
    })

    const cause: {
        data: `0x${string}`
        code: 3
        message: string
    } = await callPimlicoEntryPointSimulations(
        publicClient,
        calldata,
        finalParam
    )

    return getSimulateHandleOpResult(cause.data)
}

function getSimulateValidationResult(errorData: Hex): {
    status: "failed" | "validation"
    data: ValidationResult | Hex | string
} {
    const decodedDelegateAndError = decodeErrorResult({
        abi: EntryPointAbi,
        data: errorData
    })

    if (!decodedDelegateAndError?.args?.[1]) {
        throw new Error("Unexpected error")
    }

    try {
        const decodedError = decodeErrorResult({
            abi: EntryPointSimulationsAbi,
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
                data: parseFailedOpWithRevert(decodedError.args?.[2] as Hex)
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
    userOperation: UnPackedUserOperation,
    entryPoint: Address,
    publicClient: PublicClient
) {
    const packedUserOperation = toPackedUserOperation(userOperation)

    const entryPointSimulationsCallData = encodeFunctionData({
        abi: EntryPointSimulationsAbi,
        functionName: "simulateValidation",
        args: [packedUserOperation]
    })

    const calldata = encodeDeployData({
        abi: PimlicoEntryPointSimulationsAbi,
        bytecode: PimlicoEntryPointSimulationsBytecode,
        args: [entryPoint, entryPointSimulationsCallData]
    })

    const errorResult = await callPimlicoEntryPointSimulations(
        publicClient,
        calldata
    )

    return getSimulateValidationResult(errorResult.data)
}
