import {
    ExecutionErrors,
    pimlicoSimulationsAbi,
    RpcError,
    type StateOverrides,
    type UserOperationV07,
    ValidationErrors
} from "@alto/types"
import { type Logger, isVersion08, toPackedUserOperation } from "@alto/utils"
import { type Hex } from "viem"
import { type Address, getContract, type StateOverride } from "viem"
import {
    BinarySearchResultType,
    SimulateBinarySearchResult,
    type SimulateHandleOpResult
} from "./types"
import type { AltoConfig } from "../../createConfig"
import { packUserOps } from "../../executor/utils"
import { prepareStateOverride, decodeSimulateHandleOpError } from "./utils"
import { parseAbi } from "abitype"

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

    private getSimulationContracts(
        entryPoint: Address,
        userOperation: UserOperationV07
    ) {
        const is08 = isVersion08(userOperation, entryPoint)
        const epSimulationsAddress = is08
            ? this.config.entrypointSimulationContractV8
            : this.config.entrypointSimulationContractV7

        if (!epSimulationsAddress) {
            const errorMsg = `Cannot find entryPointSimulations Address for version ${
                is08 ? "08" : "07"
            }`
            this.logger.warn(errorMsg)
            throw new Error(errorMsg)
        }

        if (!this.config.pimlicoSimulationContract) {
            this.logger.warn("pimlicoSimulation must be provided")
            throw new RpcError(
                "pimlicoSimulation must be provided",
                ValidationErrors.InvalidFields
            )
        }

        const simulationErrors = parseAbi([
            "error FailedOp(uint256 opIndex, string reason)",
            "error FailedOpWithRevert(uint256 opIndex, string reason, bytes inner)",
            "error CallPhaseReverted(bytes reason)"
        ])

        return {
            epSimulationsAddress,
            pimlicoSimulation: getContract({
                abi: [...pimlicoSimulationsAbi, ...simulationErrors],
                address: this.config.pimlicoSimulationContract,
                client: this.config.publicClient
            })
        }
    }

    private async performBinarySearch({
        entryPoint,
        methodName,
        queuedUserOps,
        targetUserOp,
        stateOverride,
        retryCount = 0,
        initialMinGas = 9_000n,
        gasAllowance
    }: {
        entryPoint: Address
        methodName:
            | "binarySearchVerificationGas"
            | "binarySearchPaymasterVerificationGas"
            | "binarySearchCallGas"
        queuedUserOps: UserOperationV07[]
        targetUserOp: UserOperationV07
        stateOverride?: StateOverride
        retryCount?: number
        initialMinGas?: bigint
        gasAllowance?: bigint
    }): Promise<SimulateBinarySearchResult> {
        const { pimlicoSimulation, epSimulationsAddress } =
            this.getSimulationContracts(entryPoint, targetUserOp)
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
            const { result } = await pimlicoSimulation.simulate[methodName](
                [
                    epSimulationsAddress,
                    entryPoint,
                    packedQueuedOps,
                    packedTargetOp,
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

                return await this.performBinarySearch({
                    entryPoint,
                    methodName,
                    queuedUserOps,
                    targetUserOp,
                    stateOverride,
                    retryCount: retryCount + 1,
                    initialMinGas: minGas,
                    gasAllowance: newGasAllowance
                })
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

    private async simulateHandleOp({
        entryPoint,
        queuedUserOps,
        targetUserOp,
        stateOverride
    }: {
        entryPoint: Address
        queuedUserOps: UserOperationV07[]
        targetUserOp: UserOperationV07
        stateOverride?: StateOverride
    }): Promise<SimulateHandleOpResult> {
        const { pimlicoSimulation, epSimulationsAddress } =
            this.getSimulationContracts(entryPoint, targetUserOp)

        const packedQueuedOps = packUserOps(queuedUserOps)
        const packedTargetOp = toPackedUserOperation(targetUserOp)

        try {
            const result = await pimlicoSimulation.simulate.simulateHandleOp(
                [
                    epSimulationsAddress,
                    entryPoint,
                    packedQueuedOps,
                    packedTargetOp
                ],
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
            const decodedError = decodeSimulateHandleOpError(error, this.logger)
            this.logger.warn(
                { err: error, data: decodedError.data },
                "Contract function reverted in executeSimulateHandleOp"
            )
            return decodedError
        }
    }

    private async simulateAndEstimateGasLimits({
        entryPoint,
        queuedUserOps,
        targetUserOp,
        stateOverride,
        retryCount = 0
    }: {
        entryPoint: Address
        queuedUserOps: UserOperationV07[]
        targetUserOp: UserOperationV07
        stateOverride?: StateOverride
        retryCount?: number
    }): Promise<
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
        const { pimlicoSimulation, epSimulationsAddress } =
            this.getSimulationContracts(entryPoint, targetUserOp)

        const packedQueuedOps = packUserOps(queuedUserOps)
        const packedTargetOp = toPackedUserOperation(targetUserOp)

        try {
            const { result } =
                await pimlicoSimulation.simulate.simulateAndEstimateGas(
                    [
                        epSimulationsAddress,
                        entryPoint,
                        packedQueuedOps,
                        packedTargetOp,
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

            // Check if verification gas limit needs retry
            let verificationGas: bigint
            if (
                verificationGasLimit.resultType ===
                BinarySearchResultType.OutOfGas
            ) {
                const binarySearchResult = await this.performBinarySearch({
                    entryPoint,
                    methodName: "binarySearchVerificationGas",
                    queuedUserOps,
                    targetUserOp,
                    stateOverride,
                    retryCount: retryCount + 1,
                    initialMinGas: verificationGasLimit.outOfGasData.minGas,
                    gasAllowance:
                        verificationGasLimit.outOfGasData.optimalGas -
                        verificationGasLimit.outOfGasData.minGas
                })

                if (binarySearchResult.result === "failed") {
                    return binarySearchResult
                }

                verificationGas = binarySearchResult.data.gasUsed
            } else if (
                verificationGasLimit.resultType ===
                BinarySearchResultType.Success
            ) {
                verificationGas = verificationGasLimit.successData.gasUsed
            } else {
                return {
                    result: "failed",
                    data: verificationGasLimit.successData.returnData,
                    code: ExecutionErrors.UserOperationReverted
                }
            }

            // Check if paymaster verification gas limit needs retry
            let paymasterVerificationGas: bigint
            if (
                paymasterVerificationGasLimit.resultType ===
                BinarySearchResultType.OutOfGas
            ) {
                const binarySearchResult = await this.performBinarySearch({
                    entryPoint,
                    methodName: "binarySearchPaymasterVerificationGas",
                    queuedUserOps,
                    targetUserOp,
                    stateOverride,
                    retryCount: retryCount + 1,
                    initialMinGas:
                        paymasterVerificationGasLimit.outOfGasData.minGas,
                    gasAllowance:
                        paymasterVerificationGasLimit.outOfGasData.optimalGas -
                        paymasterVerificationGasLimit.outOfGasData.minGas
                })

                if (binarySearchResult.result === "failed") {
                    return binarySearchResult
                }

                paymasterVerificationGas = binarySearchResult.data.gasUsed
            } else if (
                paymasterVerificationGasLimit.resultType ===
                BinarySearchResultType.Success
            ) {
                paymasterVerificationGas =
                    paymasterVerificationGasLimit.successData.gasUsed
            } else {
                return {
                    result: "failed",
                    data: paymasterVerificationGasLimit.successData.returnData,
                    code: ExecutionErrors.UserOperationReverted
                }
            }

            return {
                result: "success",
                verificationGas,
                paymasterVerificationGas,
                executionResult: simulationResult
            }
        } catch (error) {
            const decodedError = decodeSimulateHandleOpError(error, this.logger)
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
        const { epSimulationsAddress, pimlicoSimulation } =
            this.getSimulationContracts(entryPoint, userOperation)

        const viemStateOverride = prepareStateOverride({
            userOperations: [userOperation],
            queuedUserOperations,
            config: this.config
        })

        try {
            const { result } =
                await pimlicoSimulation.simulate.simulateValidation(
                    [
                        epSimulationsAddress,
                        entryPoint,
                        packUserOps(queuedUserOperations),
                        toPackedUserOperation(userOperation)
                    ],
                    {
                        stateOverride: viemStateOverride,
                        gas: this.config.fixedGasLimitForEstimation
                    }
                )

            return {
                result: "validation",
                data: result
            }
        } catch (error) {
            const decodedError = decodeSimulateHandleOpError(error, this.logger)
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
        const { epSimulationsAddress, pimlicoSimulation } =
            this.getSimulationContracts(entryPoint, userOperation)

        const viemStateOverride = prepareStateOverride({
            userOperations: [userOperation],
            queuedUserOperations,
            stateOverrides,
            config: this.config
        })

        try {
            const { result } =
                await pimlicoSimulation.simulate.simulateHandleOp(
                    [
                        epSimulationsAddress,
                        entryPoint,
                        packUserOps(queuedUserOperations),
                        toPackedUserOperation(userOperation)
                    ],
                    {
                        stateOverride: viemStateOverride,
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
            const decodedError = decodeSimulateHandleOpError(error, this.logger)
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
        const viemStateOverride = prepareStateOverride({
            userOperations: [userOperation],
            queuedUserOperations,
            stateOverrides: userStateOverrides,
            config: this.config
        })

        if (this.config.splitSimulationCalls) {
            const [sho, bsvgl, bspvgl, bscgl] = await Promise.all([
                this.simulateHandleOp({
                    entryPoint,
                    queuedUserOps: queuedUserOperations,
                    targetUserOp: userOperation,
                    stateOverride: viemStateOverride
                }),
                this.performBinarySearch({
                    entryPoint,
                    methodName: "binarySearchVerificationGas",
                    queuedUserOps: queuedUserOperations,
                    targetUserOp: userOperation,
                    stateOverride: viemStateOverride
                }),
                this.performBinarySearch({
                    entryPoint,
                    methodName: "binarySearchPaymasterVerificationGas",
                    queuedUserOps: queuedUserOperations,
                    targetUserOp: userOperation,
                    stateOverride: viemStateOverride
                }),
                this.performBinarySearch({
                    entryPoint,
                    methodName: "binarySearchCallGas",
                    queuedUserOps: queuedUserOperations,
                    targetUserOp: userOperation,
                    stateOverride: viemStateOverride
                })
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
                this.simulateAndEstimateGasLimits({
                    entryPoint,
                    queuedUserOps: queuedUserOperations,
                    targetUserOp: userOperation,
                    stateOverride: viemStateOverride
                }),
                this.performBinarySearch({
                    entryPoint,
                    methodName: "binarySearchCallGas",
                    queuedUserOps: queuedUserOperations,
                    targetUserOp: userOperation,
                    stateOverride: viemStateOverride
                })
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
