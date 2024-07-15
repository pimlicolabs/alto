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
import {
    deepHexlify,
    getUserOperationHash,
    isVersion06,
    toPackedUserOperation
} from "@alto/utils"
import type { AbiFunction, Hex, RpcRequestErrorType } from "viem"
import {
    type Address,
    type PublicClient,
    decodeErrorResult,
    encodeFunctionData,
    toHex,
    decodeAbiParameters,
    decodeFunctionResult,
    toFunctionSelector,
    toBytes,
    slice
} from "viem"
import { z } from "zod"
import { ExecuteSimulatorDeployedBytecode } from "./ExecuteSimulator"
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
    blockTagSupport: boolean,
    finalParam: StateOverrides | undefined = undefined,
    fixedGasLimitForEstimation?: bigint
): Promise<SimulateHandleOpResult> {
    try {
        await publicClient.request({
            method: "eth_call",
            params: [
                {
                    to: entryPoint,
                    data: encodeFunctionData({
                        abi: EntryPointV06Abi,
                        functionName: "simulateHandleOp",
                        args: [userOperation, targetAddress, targetCallData]
                    }),
                    ...(fixedGasLimitForEstimation !== undefined && {
                        gas: `0x${fixedGasLimitForEstimation.toString(16)}`
                    })
                },
                blockTagSupport
                    ? "latest"
                    : toHex(await publicClient.getBlockNumber()),
                // @ts-ignore
                ...(finalParam ? [finalParam] : [])
            ]
        })
    } catch (e) {
        const err = e as RpcRequestErrorType

        if (
            /return data out of bounds.*|EVM error OutOfOffset.*/.test(
                err.details
            )
        ) {
            // out of bound (low level evm error) occurs when paymaster reverts with less than 32bytes
            return {
                result: "failed",
                data: "AA50 postOp revert (paymaster revert data out of bounds)"
            } as const
        }

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

        if (cause.data === "0x") {
            throw new RpcError(
                "AA23 reverted: UserOperation called non-existant contract, or reverted with 0x",
                ValidationErrors.SimulateValidation
            )
        }

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
            return {
                result: "failed",
                data: decodedError.args[0]
            } as const
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
    blockTagSupport: boolean,
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
    queuedUserOperations: UserOperationV07[],
    entryPoint: Address,
    publicClient: PublicClient,
    entryPointSimulationsAddress: Address,
    chainId: number,
    blockTagSupport: boolean,
    finalParam: StateOverrides | undefined = undefined,
    fixedGasLimitForEstimation?: bigint
): Promise<SimulateHandleOpResult> {
    const userOperations = [...queuedUserOperations, userOperation]

    const packedUserOperations = userOperations.map((uop) => ({
        packedUserOperation: toPackedUserOperation(uop),
        userOperation: uop,
        userOperationHash: getUserOperationHash(uop, entryPoint, chainId)
    }))

    const entryPointSimulationsSimulateHandleOpCallData = encodeFunctionData({
        abi: EntryPointV07SimulationsAbi,
        functionName: "simulateHandleOpLast",
        args: [packedUserOperations.map((uop) => uop.packedUserOperation)]
    })

    const entryPointSimulationsSimulateTargetCallData = encodeFunctionData({
        abi: EntryPointV07SimulationsAbi,
        functionName: "simulateCallDataLast",
        args: [
            packedUserOperations.map((uop) => uop.packedUserOperation),
            packedUserOperations.map(
                (packedUserOperation) =>
                    packedUserOperation.userOperation.sender
            ),
            packedUserOperations.map((packedUserOperation) => {
                const executeUserOpAbi: AbiFunction[] = [
                    {
                        inputs: [
                            {
                                components: [
                                    {
                                        internalType: "address",
                                        name: "sender",
                                        type: "address"
                                    },
                                    {
                                        internalType: "uint256",
                                        name: "nonce",
                                        type: "uint256"
                                    },
                                    {
                                        internalType: "bytes",
                                        name: "initCode",
                                        type: "bytes"
                                    },
                                    {
                                        internalType: "bytes",
                                        name: "callData",
                                        type: "bytes"
                                    },
                                    {
                                        internalType: "bytes32",
                                        name: "accountGasLimits",
                                        type: "bytes32"
                                    },
                                    {
                                        internalType: "uint256",
                                        name: "preVerificationGas",
                                        type: "uint256"
                                    },
                                    {
                                        internalType: "bytes32",
                                        name: "gasFees",
                                        type: "bytes32"
                                    },
                                    {
                                        internalType: "bytes",
                                        name: "paymasterAndData",
                                        type: "bytes"
                                    },
                                    {
                                        internalType: "bytes",
                                        name: "signature",
                                        type: "bytes"
                                    }
                                ],
                                internalType: "struct PackedUserOperation",
                                name: "userOp",
                                type: "tuple"
                            },
                            {
                                internalType: "bytes32",
                                name: "userOpHash",
                                type: "bytes32"
                            }
                        ],
                        name: "executeUserOp",
                        outputs: [],
                        stateMutability: "nonpayable",
                        type: "function"
                    }
                ]

                const executeUserOpMethodSig = toFunctionSelector(
                    executeUserOpAbi[0]
                )

                const callDataMethodSig = toHex(
                    slice(
                        toBytes(packedUserOperation.userOperation.callData),
                        0,
                        4
                    )
                )

                if (executeUserOpMethodSig === callDataMethodSig) {
                    return encodeFunctionData({
                        abi: executeUserOpAbi,
                        functionName: "executeUserOp",
                        args: [
                            packedUserOperation.packedUserOperation,
                            getUserOperationHash(
                                packedUserOperation.userOperation,
                                entryPoint,
                                chainId
                            )
                        ]
                    })
                }

                return packedUserOperation.userOperation.callData
            })
        ]
    })

    const cause = await callPimlicoEntryPointSimulations(
        publicClient,
        entryPoint,
        [
            entryPointSimulationsSimulateHandleOpCallData,
            entryPointSimulationsSimulateTargetCallData
        ],
        entryPointSimulationsAddress,
        blockTagSupport,
        finalParam,
        fixedGasLimitForEstimation
    )

    try {
        const executionResult = getSimulateHandleOpResult(cause[0])

        if (executionResult.result === "failed") {
            return executionResult
        }

        const targetCallValidationResult = validateTargetCallDataResult(
            cause[1]
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
    queuedUserOperations: UserOperation[],
    entryPoint: Address,
    publicClient: PublicClient,
    replacedEntryPoint: boolean,
    targetAddress: Address,
    targetCallData: Hex,
    balanceOverrideEnabled: boolean,
    chainId: number,
    blockTagSupport: boolean,
    stateOverride: StateOverrides = {},
    entryPointSimulationsAddress?: Address,
    fixedGasLimitForEstimation?: bigint
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
            blockTagSupport,
            finalStateOverride,
            fixedGasLimitForEstimation
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
        queuedUserOperations as UserOperationV07[],
        entryPoint,
        publicClient,
        entryPointSimulationsAddress,
        chainId,
        blockTagSupport,
        finalStateOverride,
        fixedGasLimitForEstimation
    )
}
