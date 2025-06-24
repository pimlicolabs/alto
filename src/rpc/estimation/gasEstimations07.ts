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
import {
    type Hex,
    ContractFunctionRevertedError,
    decodeErrorResult,
    parseAbi,
    BaseError,
    parseAbiItem
} from "viem"
import {
    type Address,
    getContract,
    type StateOverride,
    type GetContractReturnType,
    type PublicClient
} from "viem"
import {
    BinarySearchResultType,
    SimulateBinarySearchResult,
    type SimulateHandleOpResult
} from "./types"
import type { AltoConfig } from "../../createConfig"
import { packUserOps } from "../../executor/utils"
import { toViemStateOverrides } from "../../utils/toViemStateOverrides"
import { entryPoint07Abi } from "viem/_types/account-abstraction"

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

    private decodeSimulateHandleOpError(error: unknown): {
        result: "failed"
        data: string
        code: number
    } {
        // Check if it's a BaseError with ContractFunctionRevertedError
        if (!(error instanceof BaseError)) {
            console.log("not base error")
            return {
                result: "failed",
                data: "Unknown error, could not parse simulate validation result.",
                code: ValidationErrors.SimulateValidation
            }
        }

        const revertError = error.walk(
            (e) => e instanceof ContractFunctionRevertedError
        ) as ContractFunctionRevertedError

        if (!revertError) {
            console.log("no walk")
            return {
                result: "failed",
                data: "Unknown error, could not parse simulate validation result.",
                code: ValidationErrors.SimulateValidation
            }
        }

        if (!revertError.data?.args) {
            this.logger.debug(
                { err: error },
                "ContractFunctionRevertedError has no args"
            )
            console.log("ContractFunctionRevertedError has no args")
            console.log(revertError)
            return {
                result: "failed",
                data: "Unknown error, could not parse simulate validation result.",
                code: ValidationErrors.SimulateValidation
            }
        }

        const errorName = revertError.name
        const args = revertError.data.args

        switch (errorName) {
            case "FailedOp":
                return {
                    result: "failed",
                    data: args[1] as string,
                    code: ValidationErrors.SimulateValidation
                }

            case "FailedOpWithRevert":
                return {
                    result: "failed",
                    data: `${args[1]} ${parseFailedOpWithRevert(
                        args[2] as Hex
                    )}`,
                    code: ValidationErrors.SimulateValidation
                }

            case "CallPhaseReverted":
                return {
                    result: "failed",
                    data: args[0] as Hex,
                    code: ValidationErrors.SimulateValidation
                }

            default:
                this.logger.warn(
                    { errorName },
                    "Unknown ContractFunctionRevertedError name"
                )
                console.log("Unknown ContractFunctionRevertedError name")
                return {
                    result: "failed",
                    data: "Unknown error, could not parse simulate validation result.",
                    code: ValidationErrors.SimulateValidation
                }
        }
    }

    private async performBinarySearch(
        epSimulationsContract: GetContractReturnType<
            typeof entryPointSimulations07Abi,
            PublicClient
        >,
        methodName:
            | "binarySearchVerificationGas"
            | "binarySearchPaymasterVerificationGas"
            | "binarySearchCallGas",
        queuedUserOps: UserOperationV07[],
        targetUserOp: UserOperationV07,
        entryPoint: Address,
        stateOverride: StateOverride,
        retryCount = 0,
        initialMinGas = 9_000n,
        gasAllowance?: bigint
    ): Promise<SimulateBinarySearchResult> {
        // Check if we've hit the retry limit
        if (retryCount > this.config.binarySearchMaxRetries) {
            this.logger.warn(
                { methodName, retryCount },
                "Max retries reached in binary search"
            )
            return {
                result: "failed",
                data: `Max retries reached when calling ${methodName}`,
                code: ValidationErrors.SimulateValidation
            }
        }

        const packedQueuedOps = packUserOps(queuedUserOps)
        const packedTargetOp = toPackedUserOperation(targetUserOp)

        try {
            const { result } = await epSimulationsContract.simulate[methodName](
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

            // Check if simulation ran out of gas
            if (result.resultType === BinarySearchResultType.OutOfGas) {
                const { optimalGas, minGas } = result.outOfGasData
                const newGasAllowance = optimalGas - minGas

                return await this.performBinarySearch(
                    epSimulationsContract,
                    methodName,
                    queuedUserOps,
                    targetUserOp,
                    entryPoint,
                    stateOverride,
                    retryCount + 1,
                    minGas,
                    newGasAllowance
                )
            }

            // Check for successful result
            if (result.resultType === BinarySearchResultType.Success) {
                const successData = result.successData
                return {
                    result: "success",
                    data: {
                        gasUsed: successData.gasUsed,
                        success: successData.success,
                        returnData: successData.returnData
                    }
                } as const
            }

            return {
                result: "failed",
                data: result.successData.returnData,
                code: ExecutionErrors.UserOperationReverted
            }
        } catch (error) {
            this.logger.warn(
                { err: error, methodName },
                "Error in performBinarySearch"
            )
            return {
                result: "failed",
                data: "Unknown error, could not parse target call data result.",
                code: ExecutionErrors.UserOperationReverted
            } as const
        }
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
            return {
                result: "execution",
                data: {
                    executionResult: result.result
                }
            }
        } catch (error) {
            const decodedError = this.decodeSimulateHandleOpError(error)
            this.logger.warn(
                { err: error, data: decodedError.data },
                "Contract function reverted in executeSimulateHandleOp"
            )
            return decodedError
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
            const decodedError = this.decodeSimulateHandleOpError(error)
            this.logger.warn(
                { err: error, data: decodedError.data },
                "Contract function reverted in simulateValidation"
            )
            return decodedError
        }
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
        const is08 = isVersion08(userOperation, entryPoint)
        const entryPointSimulationsAddress = is08
            ? this.config.entrypointSimulationContractV8
            : this.config.entrypointSimulationContractV7

        if (!entryPointSimulationsAddress) {
            const errorMsg = `Cannot find entryPointSimulations Address for version ${
                is08 ? "08" : "07"
            }`
            this.logger.warn(errorMsg)
            throw new Error(errorMsg)
        }

        const stateOverride = getAuthorizationStateOverrides({
            userOperations: [...queuedUserOperations, userOperation]
        })

        try {
            const epSimulationContract = getContract({
                abi: entryPointSimulations07Abi,
                address: entryPointSimulationsAddress,
                client: this.config.publicClient
            })

            const { result } =
                await epSimulationContract.simulate.simulateValidation(
                    [
                        packUserOps(queuedUserOperations),
                        toPackedUserOperation(userOperation)
                    ],
                    {
                        stateOverride: toViemStateOverrides(stateOverride),
                        gas: this.config.fixedGasLimitForEstimation
                    }
                )

            return {
                result: "validation",
                data: result
            }
        } catch (error) {
            const decodedError = this.decodeSimulateHandleOpError(error)
            this.logger.warn(
                { err: error, data: decodedError.data },
                "Contract function reverted in simulateValidation"
            )
            return decodedError
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
            const errorMsg = `Cannot find entryPointSimulations Address for version ${
                is08 ? "08" : "07"
            }`
            this.logger.warn(errorMsg)
            throw new Error(errorMsg)
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
                        stateOverride: toViemStateOverrides(stateOverride),
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
            const decodedError = this.decodeSimulateHandleOpError(error)
            this.logger.warn(
                { err: error, data: decodedError.data },
                "Contract function reverted in validateHandleOpV07"
            )
            return decodedError
        }
    }

    async simulateHandleOp07({
        entryPoint,
        userOperation,
        queuedUserOperations,
        userStateOverrides = {}
    }: {
        entryPoint: Address
        userOperation: UserOperationV07
        queuedUserOperations: UserOperationV07[]
        userStateOverrides?: StateOverrides | undefined
    }): Promise<SimulateHandleOpResult> {
        const {
            pimlicoSimulationContract: pimlicoSimulationAddress,
            splitSimulationCalls,
            publicClient,
            entrypointSimulationContractV7,
            entrypointSimulationContractV8
        } = this.config

        const is08 = isVersion08(userOperation, entryPoint)
        const epSimulationsAddress = is08
            ? entrypointSimulationContractV8
            : entrypointSimulationContractV7

        if (!epSimulationsAddress) {
            const errorMsg = `missing entryPointSimulations contract for version ${
                is08 ? "08" : "07"
            }`
            this.logger.warn(errorMsg)
            throw new Error(errorMsg)
        }

        if (!pimlicoSimulationAddress) {
            this.logger.warn("pimlicoSimulationContract must be provided")
            throw new RpcError(
                "pimlicoSimulationContract must be provided",
                ValidationErrors.InvalidFields
            )
        }

        const epSimulationsContract = getContract({
            abi: [
                ...entryPointSimulations07Abi,
                parseAbiItem("error FailedOp(string)"), // FailedOp(string reason)
                parseAbiItem("error CallPhaseReverted(bytes)"), // CallPhaseReverted(bytes reason)
                parseAbiItem("error FailedOpWithRevert(uint256,string,bytes)") // FailedOpWithRevert(uint256 opIndex, string reason, bytes inner)
            ],
            address: epSimulationsAddress,
            client: publicClient
        })

        const pimlicoSimulationContract = getContract({
            abi: [
                pimlicoSimulationsAbi,
                parseAbiItem("error FailedOp(string)"), // FailedOp(string reason)
                parseAbiItem("error CallPhaseReverted(bytes)"), // CallPhaseReverted(bytes reason)
                parseAbiItem("error FailedOpWithRevert(uint256,string,bytes)") // FailedOpWithRevert(uint256 opIndex, string reason, bytes inner)
            ],
            address: pimlicoSimulationAddress,
            client: publicClient
        })

        const stateOverride = getAuthorizationStateOverrides({
            userOperations: [...queuedUserOperations, userOperation],
            stateOverrides: userStateOverrides
        })

        if (splitSimulationCalls) {
            const [sho, bsvgl, bspvgl, bscgl] = await Promise.all([
                this.executeSimulateHandleOp(
                    epSimulationsContract,
                    queuedUserOperations,
                    userOperation,
                    toViemStateOverrides(stateOverride)
                ),
                this.performBinarySearch(
                    epSimulationsContract,
                    "binarySearchVerificationGas",
                    queuedUserOperations,
                    userOperation,
                    entryPoint,
                    toViemStateOverrides(stateOverride)
                ),
                this.performBinarySearch(
                    epSimulationsContract,
                    "binarySearchPaymasterVerificationGas",
                    queuedUserOperations,
                    userOperation,
                    entryPoint,
                    toViemStateOverrides(stateOverride)
                ),
                this.performBinarySearch(
                    epSimulationsContract,
                    "binarySearchCallGas",
                    queuedUserOperations,
                    userOperation,
                    entryPoint,
                    toViemStateOverrides(stateOverride)
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
                    queuedUserOperations,
                    userOperation,
                    entryPoint,
                    epSimulationsAddress,
                    toViemStateOverrides(stateOverride)
                ),
                this.performBinarySearch(
                    epSimulationsContract,
                    "binarySearchCallGas",
                    queuedUserOperations,
                    userOperation,
                    entryPoint,
                    toViemStateOverrides(stateOverride)
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

export function parseFailedOpWithRevert(data: Hex) {
    try {
        const decoded = decodeErrorResult({
            abi: parseAbi(["error Error(string)", "error Panic(uint256)"]),
            data
        })

        if (decoded.errorName === "Error") {
            return decoded.args[0]
        }

        if (decoded.errorName === "Panic") {
            // from https://docs.soliditylang.org/en/v0.8.0/control-structures.html
            const panicCodes: { [key: number]: string } = {
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

            const [code] = decoded.args
            return panicCodes[Number(code)] ?? `${code}`
        }
    } catch {}

    return data
}
