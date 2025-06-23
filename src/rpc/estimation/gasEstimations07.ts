import {
    EntryPointV07Abi,
    entryPointSimulations07Abi,
    ExecutionErrors,
    type ExecutionResult,
    pimlicoSimulationsAbi,
    RpcError,
    type StateOverrides,
    type BinarySearchCallResult,
    type UserOperationV07,
    ValidationErrors,
    type ValidationResultV07,
    binarySearchCallResultSchema
} from "@alto/types"
import {
    type Logger,
    getAuthorizationStateOverrides,
    getUserOperationHash,
    isVersion08,
    toPackedUserOperation
} from "@alto/utils"
import {
    ContractFunctionExecutionError,
    type Hex,
    type ContractFunctionResult,
    type ExtractAbiFunctionNames,
    ContractFunctionRevertedError
} from "viem"
import {
    type Address,
    decodeAbiParameters,
    decodeErrorResult,
    decodeFunctionResult,
    encodeFunctionData,
    slice,
    toFunctionSelector,
    zeroAddress,
    getContract
} from "viem"
import { AccountExecuteAbi } from "../../types/contracts/IAccountExecute"
import {
    type SimulateBinarySearchRetryResult,
    type SimulateHandleOpResult,
    simulationValidationResultStruct
} from "./types"
import type { AltoConfig } from "../../createConfig"
import { packUserOps } from "../../executor/utils"

type SimulateHandleOpSuccessResult = {
    preOpGas: bigint
    paid: bigint
    accountValidationData: bigint
    paymasterValidationData: bigint
    paymasterVerificationGasLimit: bigint
    paymasterPostOpGasLimit: bigint
    targetSuccess: boolean
    targetResult: Hex
}

type GasLimitResult = {
    gasUsed: bigint
    success: boolean
    returnData: Hex
}

export class GasEstimatorV07 {
    private config: AltoConfig
    private logger: Logger

    constructor(config: AltoConfig) {
        this.config = config
        this.logger = config.getLogger(
            {
                module: "gas-estimator-v07"
            },
            {
                level: config.logLevel
            }
        )
    }

    async simulateValidation({
        entryPoint,
        userOperation,
        queuedUserOperations
    }: {
        entryPoint: Address
        userOperation: UserOperationV07
        queuedUserOperations: UserOperationV07[]
    }) {
        const userOperations = [...queuedUserOperations, userOperation]
        const packedUserOperations = userOperations.map((uo) =>
            toPackedUserOperation(uo)
        )

        const simulateValidationLast = encodeFunctionData({
            abi: entryPointSimulations07Abi,
            functionName: "simulateValidationLast",
            args: [packedUserOperations]
        })

        const stateOverrides: StateOverrides = getAuthorizationStateOverrides({
            userOperations: [...queuedUserOperations, userOperation]
        })

        const isV8 = isVersion08(userOperation, entryPoint)

        const entryPointSimulationsAddress = isV8
            ? this.config.entrypointSimulationContractV8
            : this.config.entrypointSimulationContractV7

        if (!entryPointSimulationsAddress) {
            throw new Error(
                `Cannot find entryPointSimulationsAddress for version ${
                    isV8 ? "08" : "07"
                }`
            )
        }

        const errorResult = await this.callPimlicoSimulations({
            entryPoint,
            entryPointSimulationsCallData: [simulateValidationLast],
            stateOverrides,
            entryPointSimulationsAddress
        })

        return {
            simulateValidationResult: getSimulateValidationResult(
                errorResult[0]
            )
        }
    }

    async encodeUserOperationCalldata({
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
                    await getUserOperationHash({
                        userOperation: op,
                        entryPointAddress: entryPoint,
                        chainId: this.config.chainId,
                        publicClient: this.config.publicClient
                    })
                ]
            })
        }

        return packedOp.callData
    }

    async encodeBinarySearchGasLimit({
        entryPoint,
        userOperation,
        queuedUserOperations,
        target,
        targetCallData,
        gasAllowance = this.config.binarySearchGasAllowance,
        initialMinGas = 0n,
        functionName
    }: {
        entryPoint: Address
        userOperation: UserOperationV07
        queuedUserOperations: UserOperationV07[]
        target: Address
        targetCallData: Hex
        gasAllowance?: bigint
        initialMinGas?: bigint
        functionName:
            | "binarySearchPaymasterVerificationGasLimit"
            | "binarySearchVerificationGasLimit"
            | "binarySearchCallGasLimit"
    }): Promise<Hex> {
        const queuedOps = await Promise.all(
            queuedUserOperations.map(async (op) => ({
                op: toPackedUserOperation(op),
                target: op.sender,
                targetCallData: await this.encodeUserOperationCalldata({
                    op,
                    entryPoint
                })
            }))
        )

        const targetOp = {
            op: toPackedUserOperation(userOperation),
            target,
            targetCallData
        }

        const binarySearchVerificationGasLimit = encodeFunctionData({
            abi: entryPointSimulations07Abi,
            functionName,
            args: [
                queuedOps,
                targetOp,
                entryPoint,
                initialMinGas,
                this.config.binarySearchToleranceDelta,
                gasAllowance
            ]
        })

        return binarySearchVerificationGasLimit
    }

    // Try to get the calldata gas again if the initial simulation reverted due to hitting the eth_call gasLimit.
    async retryBinarySearch({
        entryPoint,
        optimalGas,
        minGas,
        targetOp,
        target,
        targetCallData,
        functionName,
        queuedOps,
        stateOverrides = {}
    }: {
        entryPoint: Address
        optimalGas: bigint
        minGas: bigint
        targetOp: UserOperationV07
        queuedOps: UserOperationV07[]
        target: Address
        targetCallData: Hex
        functionName:
            | "binarySearchPaymasterVerificationGasLimit"
            | "binarySearchVerificationGasLimit"
            | "binarySearchCallGasLimit"
        stateOverrides?: StateOverrides | undefined
    }): Promise<SimulateBinarySearchRetryResult> {
        const maxRetries = this.config.binarySearchMaxRetries
        let retryCount = 0
        let currentOptimalGas = optimalGas
        let currentMinGas = minGas

        while (retryCount < maxRetries) {
            // OptimalGas represents the current lowest gasLimit, so we set the gasAllowance to search range minGas <-> optimalGas
            const gasAllowance = currentOptimalGas - currentMinGas

            const binarySearchCallGasLimit =
                await this.encodeBinarySearchGasLimit({
                    entryPoint,
                    userOperation: targetOp,
                    target,
                    targetCallData,
                    queuedUserOperations: queuedOps,
                    initialMinGas: currentMinGas,
                    gasAllowance,
                    functionName
                })

            stateOverrides = getAuthorizationStateOverrides({
                userOperations: [...queuedOps, targetOp],
                stateOverrides
            })

            const isV8 = isVersion08(targetOp, entryPoint)

            const entryPointSimulationsAddress = isV8
                ? this.config.entrypointSimulationContractV8
                : this.config.entrypointSimulationContractV7

            if (!entryPointSimulationsAddress) {
                throw new Error(
                    `Cannot find entryPointSimulationsAddress for version ${
                        isV8 ? "08" : "07"
                    }`
                )
            }

            let cause = await this.callPimlicoSimulations({
                entryPoint,
                entryPointSimulationsCallData: [binarySearchCallGasLimit],
                stateOverrides,
                entryPointSimulationsAddress
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

            const callGasLimitResult = validateBinarySearchDataResult(
                cause[0],
                functionName
            )

            if (callGasLimitResult.result === "failed") {
                return callGasLimitResult
            }

            if (callGasLimitResult.result === "retry") {
                currentOptimalGas = callGasLimitResult.optimalGas
                currentMinGas = callGasLimitResult.minGas
                retryCount++
                continue
            }

            // If we reach here, it means we have a successful result
            return {
                result: "success",
                data: callGasLimitResult.data
            }
        }

        // If we've exhausted all retries, return a failure result
        return {
            result: "failed",
            data: "Max retries reached for getting call data gas",
            code: ValidationErrors.SimulateValidation
        }
    }

    async validateHandleOpV07({
        entryPoint,
        userOperation,
        queuedUserOperations,
        stateOverrides = {}
    }: {
        entryPoint: Address
        userOperation: UserOperationV07
        queuedUserOperations: UserOperationV07[]
        stateOverrides?: StateOverrides | undefined
    }): Promise<SimulateHandleOpResult> {
        const simulateHandleOpLast = await this.encodeSimulateHandleOpLast({
            entryPoint,
            userOperation,
            queuedUserOperations
        })

        stateOverrides = getAuthorizationStateOverrides({
            userOperations: [...queuedUserOperations, userOperation],
            stateOverrides
        })

        const isV8 = isVersion08(userOperation, entryPoint)

        const entryPointSimulationsAddress = isV8
            ? this.config.entrypointSimulationContractV8
            : this.config.entrypointSimulationContractV7

        if (!entryPointSimulationsAddress) {
            throw new Error(
                `Cannot find entryPointSimulationsAddress for version ${
                    isV8 ? "08" : "07"
                }`
            )
        }

        let cause = [
            (
                await this.callPimlicoSimulations({
                    entryPoint,
                    entryPointSimulationsCallData: [simulateHandleOpLast],
                    stateOverrides,
                    entryPointSimulationsAddress
                })
            )[0]
        ]

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

        const [simulateHandleOpLastCause] = cause

        try {
            const simulateHandleOpLastResult = getSimulateHandleOpResult(
                simulateHandleOpLastCause
            )

            if (simulateHandleOpLastResult.result === "failed") {
                return simulateHandleOpLastResult as SimulateHandleOpResult<"failed">
            }

            return {
                result: "execution",
                data: {
                    callGasLimit: 0n,
                    verificationGasLimit: 0n,
                    paymasterVerificationGasLimit: 0n,
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

    async simulateHandleOp07({
        entryPoint,
        userOp,
        queuedUserOps,
        userStateOverrides = {}
    }: {
        entryPoint: Address
        userOp: UserOperationV07
        queuedUserOps: UserOperationV07[]
        userStateOverrides?: StateOverrides | undefined
    }): Promise<SimulateHandleOpResult> {
        const {
            pimlicoSimulationContract: pimlicoSimulationAddress,
            binarySearchToleranceDelta,
            binarySearchGasAllowance,
            splitSimulationCalls,
            publicClient,
            entrypointSimulationContractV7,
            entrypointSimulationContractV8,
            fixedGasLimitForEstimation
        } = this.config

        const is08 = isVersion08(userOp, entryPoint)
        const epSimulationsAddress = is08
            ? entrypointSimulationContractV8
            : entrypointSimulationContractV7

        if (!epSimulationsAddress) {
            throw new Error(
                `missing entryPointSimulations contract for version ${
                    is08 ? "08" : "07"
                }`
            )
        }

        if (!pimlicoSimulationAddress) {
            throw new RpcError(
                "pimlicoSimulationContract must be provided",
                ValidationErrors.InvalidFields
            )
        }

        const epSimulationsContract = getContract({
            abi: entryPointSimulations07Abi,
            address: epSimulationsAddress,
            client: publicClient
        })

        const pimlicoSimulationContract = getContract({
            abi: pimlicoSimulationsAbi,
            address: pimlicoSimulationAddress,
            client: publicClient
        })

        const stateOverride = getAuthorizationStateOverrides({
            userOperations: [...queuedUserOps, userOp],
            stateOverrides: userStateOverrides
        })

        const packedQueuedOps = packUserOps(queuedUserOps)
        const packedTargetOp = toPackedUserOperation(userOp)

        let simulateHandleOpResult:
            | SimulateHandleOpSuccessResult
            | ContractFunctionRevertedError
        let verificationGasResult: GasLimitResult
        let paymasterVerificationGasResult: GasLimitResult
        let callGasLimitResult: GasLimitResult

        if (splitSimulationCalls) {
            const [sho, fovgl, fopvgl, focgl] = await Promise.all([
                epSimulationsContract.simulate
                    .simulateHandleOp([packedQueuedOps, packedTargetOp], {
                        stateOverride,
                        gas: fixedGasLimitForEstimation
                    })
                    .then((r) => r.result)
                    .catch((e) => e),
                epSimulationsContract.simulate
                    .findOptimalVerificationGasLimit(
                        [
                            packedQueuedOps,
                            packedTargetOp,
                            entryPoint,
                            9_000n, // initialMinGas
                            binarySearchToleranceDelta,
                            binarySearchGasAllowance
                        ],
                        {
                            stateOverride,
                            gas: fixedGasLimitForEstimation
                        }
                    )
                    .then((r) => r.result),
                epSimulationsContract.simulate
                    .findOptimalPaymasterVerificationGasLimit(
                        [
                            packedQueuedOps,
                            packedTargetOp,
                            entryPoint,
                            9_000n, // initialMinGas
                            binarySearchToleranceDelta,
                            binarySearchGasAllowance
                        ],
                        {
                            stateOverride,
                            gas: fixedGasLimitForEstimation
                        }
                    )
                    .then((r) => r.result),
                epSimulationsContract.simulate
                    .findOptimalCallGasLimit(
                        [
                            packedQueuedOps,
                            packedTargetOp,
                            entryPoint,
                            9_000n, // initialMinGas
                            binarySearchToleranceDelta,
                            binarySearchGasAllowance
                        ],
                        {
                            stateOverride,
                            gas: fixedGasLimitForEstimation
                        }
                    )
                    .then((r) => r.result)
            ])

            simulateHandleOpResult = sho
            verificationGasResult = fovgl
            paymasterVerificationGasResult = fopvgl
            callGasLimitResult = focgl
        } else {
            const [saegl, focgl] = await Promise.all([
                pimlicoSimulationContract.simulate
                    .simulateAndEstimateGasLimits(
                        [
                            packedQueuedOps, // queuedUserOps
                            packedTargetOp, // targetUserOp
                            entryPoint, // entryPoint
                            epSimulationsAddress, // entryPointSimulation
                            9_000n, // initialMinGas
                            binarySearchToleranceDelta, // toleranceDelta
                            binarySearchGasAllowance // gasAllowance
                        ],
                        {
                            stateOverride,
                            gas: fixedGasLimitForEstimation
                        }
                    )
                    .then((r) => r.result)
                    .catch((e) => e),
                epSimulationsContract.simulate
                    .findOptimalCallGasLimit(
                        [
                            packedQueuedOps, // queuedUserOps
                            packedTargetOp, // targetUserOp
                            entryPoint, // entryPoint
                            9_000n, // initialMinGas
                            binarySearchToleranceDelta, // toleranceDelta
                            binarySearchGasAllowance // gasAllowance
                        ],
                        {
                            stateOverride,
                            gas: fixedGasLimitForEstimation
                        }
                    )
                    .then((r) => r.result)
            ])

            simulateHandleOpResult = saegl.simulationResult
            verificationGasResult = saegl.verificationGasLimit
            paymasterVerificationGasResult = saegl.paymasterVerificationGasLimit
            callGasLimitResult = focgl
        }

        try {
            const simulateHandleOpLastResult = getSimulateHandleOpResult(
                simulateHandleOpResult
            )

            if (simulateHandleOpLastResult.result === "failed") {
                return simulateHandleOpLastResult as SimulateHandleOpResult<"failed">
            }

            const verificationGasLimitResult = validateBinarySearchDataResult(
                verificationGasResult as unknown as Hex,
                "binarySearchVerificationGasLimit"
            )

            let verificationGasLimit = 0n

            if (verificationGasLimitResult.result === "success") {
                verificationGasLimit = verificationGasLimitResult.data.gasUsed
            }

            if (verificationGasLimitResult.result === "failed") {
                return verificationGasLimitResult
            }

            if (verificationGasLimitResult.result === "retry") {
                const { optimalGas, minGas } = verificationGasLimitResult
                const binarySearchResult = await this.retryBinarySearch({
                    entryPoint,
                    optimalGas,
                    minGas,
                    targetOp: userOperation,
                    target: zeroAddress,
                    targetCallData: "0x" as Hex,
                    functionName: "binarySearchVerificationGasLimit",
                    queuedOps: queuedUserOps,
                    stateOverrides: stateOverride
                })

                if (binarySearchResult.result === "failed") {
                    return binarySearchResult as SimulateBinarySearchRetryResult<"failed">
                }

                verificationGasLimit = (
                    binarySearchResult as SimulateBinarySearchRetryResult<"success">
                ).data.gasUsed
            }

            const paymasterVerificationGasLimitResult =
                paymasterVerificationGasResult
                    ? validateBinarySearchDataResult(
                          paymasterVerificationGasResult as unknown as Hex,
                          "binarySearchPaymasterVerificationGasLimit"
                      )
                    : ({
                          result: "success",
                          data: {
                              gasUsed: 0n,
                              success: true,
                              returnData: "0x" as Hex
                          }
                      } as { result: "success"; data: BinarySearchCallResult })

            let paymasterVerificationGasLimit = 0n

            if (paymasterVerificationGasLimitResult.result === "success") {
                paymasterVerificationGasLimit =
                    paymasterVerificationGasLimitResult.data.gasUsed
            }

            if (paymasterVerificationGasLimitResult.result === "failed") {
                return paymasterVerificationGasLimitResult
            }

            if (paymasterVerificationGasLimitResult.result === "retry") {
                const { optimalGas, minGas } =
                    paymasterVerificationGasLimitResult
                const binarySearchResult = await this.retryBinarySearch({
                    entryPoint,
                    optimalGas,
                    minGas,
                    targetOp: userOperation,
                    target: zeroAddress,
                    targetCallData: "0x" as Hex,
                    functionName: "binarySearchPaymasterVerificationGasLimit",
                    queuedOps: queuedUserOps,
                    stateOverrides: stateOverride
                })

                if (binarySearchResult.result === "failed") {
                    return binarySearchResult as SimulateBinarySearchRetryResult<"failed">
                }

                paymasterVerificationGasLimit = (
                    binarySearchResult as SimulateBinarySearchRetryResult<"success">
                ).data.gasUsed
            }

            const callGasLimitResult = validateBinarySearchDataResult(
                callGasLimitResult as unknown as Hex,
                "binarySearchCallGasLimit"
            )

            let callGasLimit = 0n

            if (callGasLimitResult.result === "success") {
                callGasLimit = callGasLimitResult.data.gasUsed
            }
            if (callGasLimitResult.result === "failed") {
                return callGasLimitResult
            }

            if (callGasLimitResult.result === "retry") {
                const { optimalGas, minGas } = callGasLimitResult
                const binarySearchResult = await this.retryBinarySearch({
                    entryPoint,
                    optimalGas,
                    minGas,
                    targetOp: userOperation,
                    target: userOperation.sender,
                    targetCallData: await this.encodeUserOperationCalldata({
                        op: userOperation,
                        entryPoint
                    }),
                    functionName: "binarySearchCallGasLimit",
                    queuedOps: queuedUserOps,
                    stateOverrides: stateOverride
                })

                if (binarySearchResult.result === "failed") {
                    return binarySearchResult as SimulateBinarySearchRetryResult<"failed">
                }

                callGasLimit = (
                    binarySearchResult as SimulateBinarySearchRetryResult<"success">
                ).data.gasUsed
            }

            return {
                result: "execution",
                data: {
                    callGasLimit,
                    verificationGasLimit,
                    paymasterVerificationGasLimit,
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
            abi: entryPointSimulations07Abi,
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

function validateBinarySearchDataResult(
    data: Hex,
    fnName:
        | "binarySearchCallGasLimit"
        | "binarySearchVerificationGasLimit"
        | "binarySearchPaymasterVerificationGasLimit"
):
    | {
          result: "success"
          data: BinarySearchCallResult
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
            abi: entryPointSimulations07Abi,
            functionName: fnName,
            data: data
        })

        const parsedTargetCallResult =
            binarySearchCallResultSchema.parse(targetCallResult)

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
        try {
            const res = decodeErrorResult({
                abi: entryPointSimulations07Abi,
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

            return {
                result: "failed",
                data,
                code: ExecutionErrors.UserOperationReverted
            }
        } catch {
            // no error we go the result
            return {
                result: "failed",
                data: "Unknown error, could not parse target call data result.",
                code: ExecutionErrors.UserOperationReverted
            } as const
        }
    }
}

function getSimulateHandleOpResult(
    data: SimulateHandleOpSuccessResult | ContractFunctionRevertedError
): SimulateHandleOpResult {
    // If data is already a successful result, return it wrapped in the expected format
    if (!(data instanceof ContractFunctionRevertedError)) {
        return {
            result: "execution",
            data: {
                executionResult: data
            }
        }
    }

    // Handle ContractFunctionExecutionError
    const error = data

    // Try to decode the error data if available
    if (error.data) {
        const errorName = error.name
        const args = error.data.args

        if (errorName === "FailedOp" && args) {
            return {
                result: "failed",
                data: args[1] as string,
                code: ValidationErrors.SimulateValidation
            } as const
        }

        if (errorName === "FailedOpWithRevert" && args) {
            return {
                result: "failed",
                data: `${args[1]} ${parseFailedOpWithRevert(args[2] as Hex)}`,
                code: ValidationErrors.SimulateValidation
            } as const
        }

        if (errorName === "CallPhaseReverted" && args) {
            return {
                result: "failed",
                data: args[0] as Hex,
                code: ValidationErrors.SimulateValidation
            } as const
        }
    }

    // Default error response
    return {
        result: "failed",
        data: error.message || "Unknown error during simulation",
        code: ValidationErrors.SimulateValidation
    }
}
