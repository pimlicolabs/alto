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
import {
    simulationValidationResultStruct,
    type SimulateHandleOpResult
} from "./types"
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
        // Check if the result hit eth_call gasLimit.
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

        // no error we go the result
        return {
            result: "failed",
            data: "Unknown error, could not parse target call data result.",
            code: ExecutionErrors.UserOperationReverted
        } as const
    }
}

function encodeSimulateHandleOpLast({
    userOperation,
    queuedUserOperations,
    entryPoint,
    chainId
}: {
    userOperation: UserOperationV07
    queuedUserOperations: UserOperationV07[]
    entryPoint: Address
    chainId: number
}): Hex {
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

    return simulateHandleOpCallData
}

function encodeSimulateCallData({
    userOperation,
    queuedUserOperations,
    entryPoint,
    chainId,
    toleranceDelta,
    gasAllowance,
    initialMinGas = 0n
}: {
    userOperation: UserOperationV07
    queuedUserOperations: UserOperationV07[]
    entryPoint: Address
    chainId: number
    initialMinGas?: bigint
    toleranceDelta: bigint
    gasAllowance: bigint
}): Hex {
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
        args: [
            queuedOps,
            targetOp,
            entryPoint,
            initialMinGas,
            toleranceDelta,
            gasAllowance
        ]
    })

    return simulateTargetCallData
}

// Try to get the calldata gas again if the initial simulation reverted due to hitting the eth_call gasLimit.
async function retryGetCallDataGas(
    optimalGas: bigint,
    minGas: bigint,
    targetOp: UserOperationV07,
    queuedOps: UserOperationV07[],
    simulateHandleOpLastResult: SimulateHandleOpResult<"execution">,
    toleranceDelta: bigint,
    entryPoint: Address,
    chainId: number,
    publicClient: PublicClient,
    entryPointSimulationsAddress: Address,
    blockTagSupport: boolean,
    utilityWalletAddress: Address,
    stateOverrides: StateOverrides | undefined = undefined,
    fixedGasLimitForEstimation?: bigint
): Promise<SimulateHandleOpResult> {
    const maxRetries = 3
    let retryCount = 0
    let currentOptimalGas = optimalGas
    let currentMinGas = minGas

    while (retryCount < maxRetries) {
        // OptimalGas represents the current lowest gasLimit, so we set the gasAllowance to search range minGas <-> optimalGas
        const gasAllowance = currentOptimalGas - currentMinGas

        const simulateCallData = encodeSimulateCallData({
            userOperation: targetOp,
            queuedUserOperations: queuedOps,
            entryPoint,
            chainId,
            initialMinGas: currentMinGas,
            toleranceDelta,
            gasAllowance
        })

        const cause = await callPimlicoEntryPointSimulations(
            publicClient,
            entryPoint,
            [simulateCallData],
            entryPointSimulationsAddress,
            blockTagSupport,
            utilityWalletAddress,
            stateOverrides,
            fixedGasLimitForEstimation
        )

        const simulateCallDataResult = validateTargetCallDataResult(cause[0])

        if (simulateCallDataResult.result === "failed") {
            return simulateCallDataResult
        }

        if (simulateCallDataResult.result === "retry") {
            currentOptimalGas = simulateCallDataResult.optimalGas
            currentMinGas = simulateCallDataResult.minGas
            retryCount++
            continue
        }

        // If we reach here, it means we have a successful result
        return {
            result: "execution",
            data: {
                callDataResult: simulateCallDataResult.data,
                executionResult: simulateHandleOpLastResult.data.executionResult
            }
        }
    }

    // If we've exhausted all retries, return a failure result
    return {
        result: "failed",
        data: "Max retries reached for getting call data gas",
        code: ValidationErrors.SimulateValidation
    }
}

export async function simulateHandleOpV07(
    userOperation: UserOperationV07,
    queuedUserOperations: UserOperationV07[],
    toleranceDelta: bigint,
    binarySearchGasAllowance: bigint,
    entryPoint: Address,
    publicClient: PublicClient,
    entryPointSimulationsAddress: Address,
    chainId: number,
    blockTagSupport: boolean,
    utilityWalletAddress: Address,
    stateOverrides: StateOverrides | undefined = undefined,
    fixedGasLimitForEstimation?: bigint
): Promise<SimulateHandleOpResult> {
    const simulateHandleOpLast = encodeSimulateHandleOpLast({
        userOperation,
        queuedUserOperations,
        entryPoint,
        chainId
    })

    const simulateCallData = encodeSimulateCallData({
        userOperation,
        queuedUserOperations,
        entryPoint,
        chainId,
        toleranceDelta,
        gasAllowance: binarySearchGasAllowance
    })

    const cause = await callPimlicoEntryPointSimulations(
        publicClient,
        entryPoint,
        [simulateHandleOpLast, simulateCallData],
        entryPointSimulationsAddress,
        blockTagSupport,
        utilityWalletAddress,
        stateOverrides,
        fixedGasLimitForEstimation
    )

    try {
        const simulateHandleOpLastResult = getSimulateHandleOpResult(cause[0])

        if (simulateHandleOpLastResult.result === "failed") {
            return simulateHandleOpLastResult
        }

        const simulateCallDataResult = validateTargetCallDataResult(cause[1])

        if (simulateCallDataResult.result === "failed") {
            return simulateCallDataResult
        }

        if (simulateCallDataResult.result === "retry") {
            const { optimalGas, minGas } = simulateCallDataResult
            return await retryGetCallDataGas(
                optimalGas,
                minGas,
                userOperation,
                queuedUserOperations,
                simulateHandleOpLastResult as SimulateHandleOpResult<"execution">,
                toleranceDelta,
                entryPoint,
                chainId,
                publicClient,
                entryPointSimulationsAddress,
                blockTagSupport,
                utilityWalletAddress,
                stateOverrides,
                fixedGasLimitForEstimation
            )
        }

        return {
            result: "execution",
            data: {
                callDataResult: simulateCallDataResult.data,
                executionResult: (
                    simulateHandleOpLastResult as SimulateHandleOpResult<"execution">
                ).data.executionResult
            }
        }
    } catch (_e) {
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
            simulationValidationResultStruct,
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
