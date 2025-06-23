import {
    entryPointSimulations07Abi,
    ExecutionErrors,
    pimlicoSimulationsAbi,
    RpcError,
    type StateOverrides,
    type UserOperationV07,
    ValidationErrors
} from "@alto/types"
import {
    type Logger,
    getAuthorizationStateOverrides,
    isVersion08,
    toPackedUserOperation
} from "@alto/utils"
import { type Hex, ContractFunctionRevertedError } from "viem"
import {
    type Address,
    decodeAbiParameters,
    slice,
    getContract,
    type StateOverride,
    type GetContractReturnType,
    type PublicClient
} from "viem"
import {
    SimulateBinarySearchResult,
    type SimulateHandleOpResult
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

    private async executeSimulateHandleOp(
        epSimulationsContract: GetContractReturnType<
            typeof entryPointSimulations07Abi,
            PublicClient
        >,
        queuedUserOps: UserOperationV07[],
        targetUserOp: UserOperationV07,
        stateOverride: StateOverride
    ): Promise<SimulateHandleOpResult> {
        const packedQueuedOps = packUserOps(queuedUserOps)
        const packedTargetOp = toPackedUserOperation(targetUserOp)

        try {
            const result =
                await epSimulationsContract.simulate.simulateHandleOp(
                    [packedQueuedOps, packedTargetOp],
                    {
                        stateOverride,
                        gas: this.config.fixedGasLimitForEstimation
                    }
                )
            return getSimulateHandleOpResult(result.result)
        } catch (error) {
            if (error instanceof ContractFunctionRevertedError) {
                return getSimulateHandleOpResult(error)
            }
            throw error
        }
    }

    private async binarySearchVerificationGasLimit(
        epSimulationsContract: GetContractReturnType<
            typeof entryPointSimulations07Abi,
            PublicClient
        >,
        queuedUserOps: UserOperationV07[],
        targetUserOp: UserOperationV07,
        entryPoint: Address,
        stateOverride: StateOverride,
        retryCount = 0,
        initialMinGas = 9_000n,
        gasAllowance?: bigint
    ): Promise<SimulateBinarySearchResult> {
        const packedQueuedOps = packUserOps(queuedUserOps)
        const packedTargetOp = toPackedUserOperation(targetUserOp)

        try {
            const { result } =
                await epSimulationsContract.simulate.findOptimalVerificationGasLimit(
                    [
                        packedQueuedOps,
                        packedTargetOp,
                        entryPoint,
                        initialMinGas,
                        this.config.binarySearchToleranceDelta,
                        gasAllowance ?? this.config.binarySearchGasAllowance
                    ],
                    {
                        stateOverride,
                        gas: this.config.fixedGasLimitForEstimation
                    }
                )

            if (result.success) {
                return {
                    result: "success",
                    data: result
                } as const
            }

            return {
                result: "failed",
                data: result.returnData,
                code: ExecutionErrors.UserOperationReverted
            }
        } catch (error) {
            if (
                error instanceof ContractFunctionRevertedError &&
                error.name === "SimulationOutOfGas" &&
                error.data &&
                error.data.args
            ) {
                const [optimalGas, minGas] = error.data.args as [
                    bigint,
                    bigint,
                    bigint
                ]

                // Check if we've hit the retry limit
                if (retryCount >= this.config.binarySearchMaxRetries) {
                    return {
                        result: "failed",
                        data: "Max retries reached for verification gas limit search",
                        code: ValidationErrors.SimulateValidation
                    } as const
                }

                // Recursively call itself with new gas limits
                const newGasAllowance = optimalGas - minGas
                return this.binarySearchVerificationGasLimit(
                    epSimulationsContract,
                    queuedUserOps,
                    targetUserOp,
                    entryPoint,
                    stateOverride,
                    retryCount + 1,
                    minGas,
                    newGasAllowance
                )
            }

            return {
                result: "failed",
                data: "Unknown error, could not parse target call data result.",
                code: ExecutionErrors.UserOperationReverted
            } as const
        }
    }

    private async binarySearchPaymasterVerificationGasLimit(
        epSimulationsContract: GetContractReturnType<
            typeof entryPointSimulations07Abi,
            PublicClient
        >,
        queuedUserOps: UserOperationV07[],
        targetUserOp: UserOperationV07,
        entryPoint: Address,
        stateOverride: StateOverride,
        retryCount = 0,
        initialMinGas = 9_000n,
        gasAllowance?: bigint
    ): Promise<SimulateBinarySearchResult> {
        const packedQueuedOps = packUserOps(queuedUserOps)
        const packedTargetOp = toPackedUserOperation(targetUserOp)

        try {
            const { result } =
                await epSimulationsContract.simulate.findOptimalPaymasterVerificationGasLimit(
                    [
                        packedQueuedOps,
                        packedTargetOp,
                        entryPoint,
                        initialMinGas,
                        this.config.binarySearchToleranceDelta,
                        gasAllowance ?? this.config.binarySearchGasAllowance
                    ],
                    {
                        stateOverride,
                        gas: this.config.fixedGasLimitForEstimation
                    }
                )

            if (result.success) {
                return {
                    result: "success",
                    data: result
                } as const
            }

            return {
                result: "failed",
                data: result.returnData,
                code: ExecutionErrors.UserOperationReverted
            }
        } catch (error) {
            if (
                error instanceof ContractFunctionRevertedError &&
                error.name === "SimulationOutOfGas" &&
                error.data &&
                error.data.args
            ) {
                const [optimalGas, minGas] = error.data.args as [
                    bigint,
                    bigint,
                    bigint
                ]

                // Check if we've hit the retry limit
                if (retryCount >= this.config.binarySearchMaxRetries) {
                    return {
                        result: "failed",
                        data: "Max retries reached for paymaster verification gas limit search",
                        code: ValidationErrors.SimulateValidation
                    } as const
                }

                // Recursively call itself with new gas limits
                const newGasAllowance = optimalGas - minGas
                return this.binarySearchPaymasterVerificationGasLimit(
                    epSimulationsContract,
                    queuedUserOps,
                    targetUserOp,
                    entryPoint,
                    stateOverride,
                    retryCount + 1,
                    minGas,
                    newGasAllowance
                )
            }

            return {
                result: "failed",
                data: "Unknown error, could not parse target call data result.",
                code: ExecutionErrors.UserOperationReverted
            } as const
        }
    }

    private async simulateAndEstimateGasLimits(
        pimlicoSimulationContract: GetContractReturnType<
            typeof pimlicoSimulationsAbi,
            PublicClient
        >,
        queuedUserOps: UserOperationV07[],
        targetUserOp: UserOperationV07,
        entryPoint: Address,
        epSimulationsAddress: Address,
        stateOverride: StateOverride
    ): Promise<
        | {
              result: "success"
              verificationGas: bigint
              paymasterVerificationGas: bigint
              executionResult: SimulateHandleOpSuccessResult
          }
        | {
              result: "failed"
              data: string
              code: number
          }
    > {
        const packedQueuedOps = packUserOps(queuedUserOps)
        const packedTargetOp = toPackedUserOperation(targetUserOp)

        try {
            const { result } =
                await pimlicoSimulationContract.simulate.simulateAndEstimateGasLimits(
                    [
                        packedQueuedOps,
                        packedTargetOp,
                        entryPoint,
                        epSimulationsAddress,
                        9_000n,
                        this.config.binarySearchToleranceDelta,
                        this.config.binarySearchGasAllowance
                    ],
                    {
                        stateOverride,
                        gas: this.config.fixedGasLimitForEstimation
                    }
                )

            const {
                verificationGasLimit,
                paymasterVerificationGasLimit,
                simulationResult
            } = result

            return {
                result: "success",
                verificationGas: verificationGasLimit.gasUsed,
                paymasterVerificationGas: paymasterVerificationGasLimit.gasUsed,
                executionResult: simulationResult
            }
        } catch (error) {
            if (error instanceof Error) {
                const errorName = error.name

                if (errorName === "EstimateGasExecutionError") {
                    return {
                        result: "failed",
                        data: "UserOperation execution reverted",
                        code: ExecutionErrors.UserOperationReverted
                    }
                }

                if (errorName === "EstimateGasUserOperationError") {
                    return {
                        result: "failed",
                        data: error.message,
                        code: ValidationErrors.SimulateValidation
                    }
                }

                return {
                    result: "failed",
                    data: "Unknown error during gas estimation",
                    code: ValidationErrors.SimulateValidation
                }
            }

            return {
                result: "failed",
                data: "Unknown error in simulateAndEstimateGasLimits",
                code: ValidationErrors.SimulateValidation
            }
        }
    }

    private async binarySearchCallGasLimit(
        epSimulationsContract: GetContractReturnType<
            typeof entryPointSimulations07Abi,
            PublicClient
        >,
        queuedUserOps: UserOperationV07[],
        targetUserOp: UserOperationV07,
        entryPoint: Address,
        stateOverride: StateOverride,
        retryCount = 0,
        initialMinGas = 9_000n,
        gasAllowance?: bigint
    ): Promise<SimulateBinarySearchResult> {
        const packedQueuedOps = packUserOps(queuedUserOps)
        const packedTargetOp = toPackedUserOperation(targetUserOp)

        try {
            const { result } =
                await epSimulationsContract.simulate.findOptimalCallGasLimit(
                    [
                        packedQueuedOps,
                        packedTargetOp,
                        entryPoint,
                        initialMinGas,
                        this.config.binarySearchToleranceDelta,
                        gasAllowance ?? this.config.binarySearchGasAllowance
                    ],
                    {
                        stateOverride,
                        gas: this.config.fixedGasLimitForEstimation
                    }
                )

            if (result.success) {
                return {
                    result: "success",
                    data: result
                } as const
            }

            return {
                result: "failed",
                data: result.returnData,
                code: ExecutionErrors.UserOperationReverted
            }
        } catch (error) {
            if (
                error instanceof ContractFunctionRevertedError &&
                error.name === "SimulationOutOfGas" &&
                error.data &&
                error.data.args
            ) {
                const [optimalGas, minGas] = error.data.args as [
                    bigint,
                    bigint,
                    bigint
                ]

                // Check if we've hit the retry limit
                if (retryCount >= this.config.binarySearchMaxRetries) {
                    return {
                        result: "failed",
                        data: "Max retries reached for call gas limit search",
                        code: ValidationErrors.SimulateValidation
                    }
                }

                // Recursively call itself with new gas limits
                const newGasAllowance = optimalGas - minGas
                return this.binarySearchCallGasLimit(
                    epSimulationsContract,
                    queuedUserOps,
                    targetUserOp,
                    entryPoint,
                    stateOverride,
                    retryCount + 1,
                    minGas,
                    newGasAllowance
                )
            }

            return {
                result: "failed",
                data: "Unknown error, could not parse target call data result.",
                code: ExecutionErrors.UserOperationReverted
            } as const
        }
    }

    async simulateValidation({
        entryPoint,
        userOp,
        queuedUserOps
    }: {
        entryPoint: Address
        userOp: UserOperationV07
        queuedUserOps: UserOperationV07[]
    }) {
        const is08 = isVersion08(userOp, entryPoint)
        const entryPointSimulationsAddress = is08
            ? this.config.entrypointSimulationContractV8
            : this.config.entrypointSimulationContractV7

        if (!entryPointSimulationsAddress) {
            throw new Error(
                `Cannot find entryPointSimulations Address for version ${
                    is08 ? "08" : "07"
                }`
            )
        }

        const stateOverride = getAuthorizationStateOverrides({
            userOperations: [...queuedUserOps, userOp]
        })

        try {
            const epSimulationContract = getContract({
                abi: entryPointSimulations07Abi,
                address: entryPointSimulationsAddress,
                client: this.config.publicClient
            })

            const { result } =
                await epSimulationContract.simulate.simulateValidation(
                    [packUserOps(queuedUserOps), toPackedUserOperation(userOp)],
                    {
                        stateOverride,
                        gas: this.config.fixedGasLimitForEstimation
                    }
                )

            return {
                status: "validation",
                data: result
            }
        } catch (error) {
            if (
                error instanceof ContractFunctionRevertedError &&
                error.name === "FailedOp" &&
                error.data &&
                error.data.args
            ) {
                return {
                    status: "failed",
                    data: error.data.args[1] as string
                } as const
            }

            if (
                error instanceof ContractFunctionRevertedError &&
                error.name === "FailedOpWithRevert" &&
                error.data &&
                error.data.args
            ) {
                return {
                    status: "failed",
                    data: `${error.data.args[1]} - ${parseFailedOpWithRevert(
                        error.data.args[2] as Hex
                    )}`
                } as const
            }
        }

        return {
            status: "failed",
            data: "Unknown error, could not parse simulate validation result.",
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
        const is08 = isVersion08(userOperation, entryPoint)
        const entryPointSimulationsAddress = is08
            ? this.config.entrypointSimulationContractV8
            : this.config.entrypointSimulationContractV7

        if (!entryPointSimulationsAddress) {
            throw new Error(
                `Cannot find entryPointSimulations Address for version ${
                    is08 ? "08" : "07"
                }`
            )
        }

        const stateOverride = getAuthorizationStateOverrides({
            userOperations: [...queuedUserOperations, userOperation],
            stateOverrides
        })

        try {
            const epSimulationContract = getContract({
                abi: entryPointSimulations07Abi,
                address: entryPointSimulationsAddress,
                client: this.config.publicClient
            })

            const { result } =
                await epSimulationContract.simulate.simulateHandleOp(
                    [
                        packUserOps(queuedUserOperations),
                        toPackedUserOperation(userOperation)
                    ],
                    {
                        stateOverride,
                        gas: this.config.fixedGasLimitForEstimation
                    }
                )

            return {
                result: "execution",
                data: {
                    callGasLimit: 0n,
                    verificationGasLimit: 0n,
                    paymasterVerificationGasLimit: 0n,
                    executionResult: result
                }
            }
        } catch (error) {
            if (
                error instanceof ContractFunctionRevertedError &&
                error.name === "FailedOp" &&
                error.data &&
                error.data.args
            ) {
                return {
                    result: "failed",
                    data: error.data.args[1] as string,
                    code: ValidationErrors.SimulateValidation
                } as const
            }

            if (
                error instanceof ContractFunctionRevertedError &&
                error.name === "FailedOpWithRevert" &&
                error.data &&
                error.data.args
            ) {
                return {
                    result: "failed",
                    data: `${error.data.args[1]} - ${parseFailedOpWithRevert(
                        error.data.args[2] as Hex
                    )}`,
                    code: ValidationErrors.SimulateValidation
                } as const
            }

            if (
                error instanceof ContractFunctionRevertedError &&
                error.name === "CallPhaseReverted" &&
                error.data &&
                error.data.args
            ) {
                return {
                    result: "failed",
                    data: error.data.args[0] as Hex,
                    code: ValidationErrors.SimulateValidation
                } as const
            }
        }

        return {
            result: "failed",
            data: "Unknown error, could not parse simulate handle op result.",
            code: ValidationErrors.SimulateValidation
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
            splitSimulationCalls,
            publicClient,
            entrypointSimulationContractV7,
            entrypointSimulationContractV8
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

        if (splitSimulationCalls) {
            const [sho, bsvgl, bspvgl, bscgl] = await Promise.all([
                this.executeSimulateHandleOp(
                    epSimulationsContract,
                    queuedUserOps,
                    userOp,
                    stateOverride
                ),
                this.binarySearchVerificationGasLimit(
                    epSimulationsContract,
                    queuedUserOps,
                    userOp,
                    entryPoint,
                    stateOverride
                ),
                this.binarySearchPaymasterVerificationGasLimit(
                    epSimulationsContract,
                    queuedUserOps,
                    userOp,
                    entryPoint,
                    stateOverride
                ),
                this.binarySearchCallGasLimit(
                    epSimulationsContract,
                    queuedUserOps,
                    userOp,
                    entryPoint,
                    stateOverride
                )
            ])

            if (sho.result === "failed") {
                return sho
            }

            if (bsvgl.result === "failed") {
                return bsvgl
            }

            if (bspvgl.result === "failed") {
                return bspvgl
            }

            if (bscgl.result === "failed") {
                return bscgl
            }

            return {
                result: "execution",
                data: {
                    callGasLimit: bscgl.data.gasUsed,
                    verificationGasLimit: bsvgl.data.gasUsed,
                    paymasterVerificationGasLimit: bspvgl.data.gasUsed,
                    executionResult: sho.data.executionResult
                }
            }
        } else {
            const [saegl, focgl] = await Promise.all([
                this.simulateAndEstimateGasLimits(
                    pimlicoSimulationContract,
                    queuedUserOps,
                    userOp,
                    entryPoint,
                    epSimulationsAddress,
                    stateOverride
                ),
                this.binarySearchCallGasLimit(
                    epSimulationsContract,
                    queuedUserOps,
                    userOp,
                    entryPoint,
                    stateOverride
                )
            ])

            if (saegl.result === "failed") {
                return saegl
            }

            if (focgl.result === "failed") {
                return focgl
            }

            const {
                verificationGas,
                paymasterVerificationGas,
                executionResult
            } = saegl

            return {
                result: "execution",
                data: {
                    callGasLimit: focgl.data.gasUsed,
                    verificationGasLimit: verificationGas,
                    paymasterVerificationGasLimit: paymasterVerificationGas,
                    executionResult: executionResult
                }
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
    const methodSig = slice(data, 0, 4)
    const dataParams = slice(data, 4)

    // Selector for Error(string)
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

    // Selector for Panic(uint256)
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
