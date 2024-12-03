import {
    EntryPointV07Abi,
    EntryPointV07SimulationsAbi,
    ExecutionErrors,
    type ExecutionResult,
    PimlicoEntryPointSimulationsAbi,
    RpcError,
    type StateOverrides,
    type TargetCallResult,
    type UserOperationV07,
    ValidationErrors,
    type ValidationResultV07,
    targetCallResultSchema
} from "@alto/types"
import {
    addAuthorizationStateOverrides,
    getUserOperationHash,
    toPackedUserOperation
} from "@alto/utils"
import type { Hex } from "viem"
import {
    type Address,
    decodeAbiParameters,
    decodeErrorResult,
    decodeFunctionResult,
    encodeFunctionData,
    slice,
    toFunctionSelector,
    toHex
} from "viem"
import { AccountExecuteAbi } from "../../types/contracts/IAccountExecute"
import {
    type SimulateHandleOpResult,
    simulationValidationResultStruct
} from "./types"
import type { AltoConfig } from "../../createConfig"
import { SignedAuthorizationList } from "viem/experimental"

export class GasEstimatorV07 {
    private config: AltoConfig

    constructor(config: AltoConfig) {
        this.config = config
    }

    async simulateValidation({
        entryPoint,
        userOperation,
        queuedUserOperations,
        authorizationList
    }: {
        entryPoint: Address
        userOperation: UserOperationV07
        queuedUserOperations: UserOperationV07[]
        authorizationList?: SignedAuthorizationList
    }) {
        const userOperations = [...queuedUserOperations, userOperation]
        const packedUserOperations = userOperations.map((uo) =>
            toPackedUserOperation(uo)
        )

        const simulateValidationLast = encodeFunctionData({
            abi: EntryPointV07SimulationsAbi,
            functionName: "simulateValidationLast",
            args: [packedUserOperations]
        })

        const errorResult = await this.callPimlicoEntryPointSimulations({
            entryPoint,
            entryPointSimulationsCallData: [simulateValidationLast],
            authorizationList
        })

        return {
            simulateValidationResult: getSimulateValidationResult(
                errorResult[0]
            )
        }
    }

    encodeUserOperationCalldata({
        op,
        entryPoint
    }: {
        op: UserOperationV07
        entryPoint: Address
    }) {
        const packedOp = toPackedUserOperation(op)
        const executeUserOpMethodSig = toFunctionSelector(AccountExecuteAbi[0])

        const callDataMethodSig = slice(packedOp.callData, 0, 4)

        if (executeUserOpMethodSig === callDataMethodSig) {
            return encodeFunctionData({
                abi: AccountExecuteAbi,
                functionName: "executeUserOp",
                args: [
                    packedOp,
                    getUserOperationHash(
                        op,
                        entryPoint,
                        this.config.publicClient.chain.id
                    )
                ]
            })
        }

        return packedOp.callData
    }

    encodeSimulateHandleOpLast({
        userOperation,
        queuedUserOperations,
        entryPoint
    }: {
        userOperation: UserOperationV07
        queuedUserOperations: UserOperationV07[]
        entryPoint: Address
    }): Hex {
        const userOperations = [...queuedUserOperations, userOperation]
        const packedUserOperations = userOperations.map((uop) => ({
            packedUserOperation: toPackedUserOperation(uop),
            userOperation: uop,
            userOperationHash: getUserOperationHash(
                uop,
                entryPoint,
                this.config.publicClient.chain.id
            )
        }))

        const simulateHandleOpCallData = encodeFunctionData({
            abi: EntryPointV07SimulationsAbi,
            functionName: "simulateHandleOpLast",
            args: [packedUserOperations.map((uop) => uop.packedUserOperation)]
        })

        return simulateHandleOpCallData
    }

    encodeSimulateCallData({
        userOperation,
        queuedUserOperations,
        entryPoint,
        gasAllowance = this.config.binarySearchGasAllowance,
        initialMinGas = 0n
    }: {
        userOperation: UserOperationV07
        queuedUserOperations: UserOperationV07[]
        entryPoint: Address
        initialMinGas?: bigint
        gasAllowance?: bigint
    }): Hex {
        const queuedOps = queuedUserOperations.map((op) => ({
            op: toPackedUserOperation(op),
            target: op.sender,
            targetCallData: this.encodeUserOperationCalldata({
                op,
                entryPoint
            })
        }))

        const targetOp = {
            op: toPackedUserOperation(userOperation),
            target: userOperation.sender,
            targetCallData: this.encodeUserOperationCalldata({
                op: userOperation,
                entryPoint
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
                this.config.binarySearchToleranceDelta,
                gasAllowance
            ]
        })

        return simulateTargetCallData
    }

    // Try to get the calldata gas again if the initial simulation reverted due to hitting the eth_call gasLimit.
    async retryGetCallDataGas({
        entryPoint,
        optimalGas,
        minGas,
        targetOp,
        queuedOps,
        stateOverrides,
        simulateHandleOpLastResult,
        authorizationList
    }: {
        entryPoint: Address
        optimalGas: bigint
        minGas: bigint
        targetOp: UserOperationV07
        queuedOps: UserOperationV07[]
        stateOverrides?: StateOverrides | undefined
        simulateHandleOpLastResult: SimulateHandleOpResult<"execution">
        authorizationList?: SignedAuthorizationList
    }): Promise<SimulateHandleOpResult> {
        const maxRetries = 3
        let retryCount = 0
        let currentOptimalGas = optimalGas
        let currentMinGas = minGas

        while (retryCount < maxRetries) {
            // OptimalGas represents the current lowest gasLimit, so we set the gasAllowance to search range minGas <-> optimalGas
            const gasAllowance = currentOptimalGas - currentMinGas

            const simulateCallData = this.encodeSimulateCallData({
                entryPoint,
                userOperation: targetOp,
                queuedUserOperations: queuedOps,
                initialMinGas: currentMinGas,
                gasAllowance
            })

            let cause = await this.callPimlicoEntryPointSimulations({
                entryPoint,
                entryPointSimulationsCallData: [simulateCallData],
                stateOverrides,
                authorizationList
            })

            cause = cause.map((data: Hex) => {
                const decodedDelegateAndError = decodeErrorResult({
                    abi: EntryPointV07Abi,
                    data: data
                })

                if (!decodedDelegateAndError?.args?.[1]) {
                    throw new Error("Unexpected error")
                }
                return decodedDelegateAndError.args[1] as Hex
            })

            const simulateCallDataResult = validateTargetCallDataResult(
                cause[0]
            )

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
                    executionResult:
                        simulateHandleOpLastResult.data.executionResult
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

    async simulateHandleOpV07({
        entryPoint,
        userOperation,
        queuedUserOperations,
        stateOverrides = undefined,
        authorizationList
    }: {
        entryPoint: Address
        userOperation: UserOperationV07
        queuedUserOperations: UserOperationV07[]
        stateOverrides?: StateOverrides | undefined
        authorizationList?: SignedAuthorizationList
    }): Promise<SimulateHandleOpResult> {
        const simulateHandleOpLast = this.encodeSimulateHandleOpLast({
            entryPoint,
            userOperation,
            queuedUserOperations
        })

        const simulateCallData = this.encodeSimulateCallData({
            entryPoint,
            userOperation,
            queuedUserOperations
        })

        let cause: readonly Hex[]

        if (this.config.chainType === "hedera") {
            // due to Hedera specific restrictions, we can't combine these two calls.
            const [simulateHandleOpLastCause, simulateCallDataCause] =
                await Promise.all([
                    this.callPimlicoEntryPointSimulations({
                        entryPoint,
                        entryPointSimulationsCallData: [simulateHandleOpLast],
                        stateOverrides,
                        authorizationList
                    }),
                    this.callPimlicoEntryPointSimulations({
                        entryPoint,
                        entryPointSimulationsCallData: [simulateCallData],
                        stateOverrides,
                        authorizationList
                    })
                ])

            cause = [simulateHandleOpLastCause[0], simulateCallDataCause[0]]
        } else {
            cause = await this.callPimlicoEntryPointSimulations({
                entryPoint,
                entryPointSimulationsCallData: [
                    simulateHandleOpLast,
                    simulateCallData
                ],
                stateOverrides,
                authorizationList
            })
        }

        cause = cause.map((data: Hex) => {
            const decodedDelegateAndError = decodeErrorResult({
                abi: EntryPointV07Abi,
                data: data
            })

            const delegateAndRevertResponseBytes =
                decodedDelegateAndError?.args?.[1]

            if (!delegateAndRevertResponseBytes) {
                throw new Error("Unexpected error")
            }

            return delegateAndRevertResponseBytes as Hex
        })

        try {
            const simulateHandleOpLastResult = getSimulateHandleOpResult(
                cause[0]
            )

            if (simulateHandleOpLastResult.result === "failed") {
                return simulateHandleOpLastResult
            }

            const simulateCallDataResult = validateTargetCallDataResult(
                cause[1]
            )

            if (simulateCallDataResult.result === "failed") {
                return simulateCallDataResult
            }

            if (simulateCallDataResult.result === "retry") {
                const { optimalGas, minGas } = simulateCallDataResult
                return await this.retryGetCallDataGas({
                    entryPoint,
                    optimalGas,
                    minGas,
                    targetOp: userOperation,
                    queuedOps: queuedUserOperations,
                    simulateHandleOpLastResult:
                        simulateHandleOpLastResult as SimulateHandleOpResult<"execution">,
                    stateOverrides
                })
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

    async callPimlicoEntryPointSimulations({
        entryPoint,
        entryPointSimulationsCallData,
        stateOverrides,
        authorizationList
    }: {
        entryPoint: Address
        entryPointSimulationsCallData: Hex[]
        stateOverrides?: StateOverrides
        authorizationList?: SignedAuthorizationList
    }) {
        const publicClient = this.config.publicClient

        // TODO: WHERE TO PUT THIS?
        const blockTagSupport = this.config.blockTagSupport

        const utilityWalletAddress =
            this.config.utilityPrivateKey?.address ??
            "0x4337000c2828F5260d8921fD25829F606b9E8680"
        const entryPointSimulationsAddress =
            this.config.entrypointSimulationContract
        const fixedGasLimitForEstimation =
            this.config.fixedGasLimitForEstimation

        if (!entryPointSimulationsAddress) {
            throw new RpcError(
                "entryPointSimulationsAddress must be provided for V07 UserOperation",
                ValidationErrors.InvalidFields
            )
        }

        const callData = encodeFunctionData({
            abi: PimlicoEntryPointSimulationsAbi,
            functionName: "simulateEntryPoint",
            args: [entryPoint, entryPointSimulationsCallData]
        })

        if (authorizationList) {
            stateOverrides = await addAuthorizationStateOverrides({
                stateOverrides,
                authorizationList,
                publicClient
            })
        }

        // Remove state override if not supported by network.
        if (!this.config.balanceOverride) {
            stateOverrides = undefined
        }

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
                ...(stateOverrides ? [stateOverrides] : [])
            ]
        })) as Hex

        const returnBytes = decodeAbiParameters(
            [{ name: "ret", type: "bytes[]" }],
            result
        )

        return returnBytes[0]
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
                data: `${decodedError.args[1]} ${parseFailedOpWithRevert(
                    decodedError.args?.[2] as Hex
                )}`,
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
