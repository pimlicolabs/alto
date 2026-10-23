import type { GasPriceManager } from "@alto/handlers"
import {
    ERC7769Errors,
    RpcError,
    type StateOverrides,
    type UserOperation07,
    pimlicoSimulationsAbi
} from "@alto/types"
import {
    type Logger,
    getEntryPointSimulationsAddress,
    getViemEntryPointVersion,
    toPackedUserOp
} from "@alto/utils"
import { type Address, type Hex, type StateOverride, getContract } from "viem"
import type { AltoConfig } from "../../createConfig"
import { packUserOps } from "../../executor/utils"
import {
    BinarySearchResultType,
    type SimulateBinarySearchResult,
    type SimulateHandleOpResult
} from "./types"
import {
    decodeSimulateHandleOpError,
    prepareSimulationOverrides07,
    prepareStateOverride,
    simulationErrors
} from "./utils"

const getPimlicoSimulation = (config: AltoConfig) => {
    if (!config.pimlicoSimulationContract) {
        throw new RpcError(
            "pimlicoSimulation must be provided",
            ERC7769Errors.InvalidFields
        )
    }

    return getContract({
        abi: [...pimlicoSimulationsAbi, ...simulationErrors],
        address: config.pimlicoSimulationContract,
        client: config.publicClient
    })
}

// A userOp simulation through PimlicoSimulations, shared by every call that
// simulates the same userOp with the same state override
type Simulation = {
    pimlicoSimulation: ReturnType<typeof getPimlicoSimulation>
    epSimulationsAddress: Address
    entryPoint: Address
    packedQueuedOps: ReturnType<typeof packUserOps>
    packedTargetOp: ReturnType<typeof toPackedUserOp>
    stateOverride?: StateOverride
}

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

export class GasEstimator07 {
    private readonly config: AltoConfig
    private readonly logger: Logger
    private readonly gasPriceManager: GasPriceManager

    constructor(config: AltoConfig, gasPriceManager: GasPriceManager) {
        this.config = config
        this.gasPriceManager = gasPriceManager
        this.logger = config.getLogger(
            {
                module: "gas-estimator-v07"
            },
            {
                level: config.logLevel
            }
        )
    }

    private getSimulation({
        entryPoint,
        userOp,
        queuedUserOps,
        stateOverride
    }: {
        entryPoint: Address
        userOp: UserOperation07
        queuedUserOps: UserOperation07[]
        stateOverride?: StateOverride
    }): Simulation {
        const version = getViemEntryPointVersion(userOp, entryPoint)
        const epSimulationsAddress = getEntryPointSimulationsAddress({
            version,
            config: this.config
        })

        if (!epSimulationsAddress) {
            const errorMsg = `Cannot find entryPointSimulations Address for version ${version}`
            this.logger.warn(errorMsg)
            throw new Error(errorMsg)
        }

        return {
            pimlicoSimulation: getPimlicoSimulation(this.config),
            epSimulationsAddress,
            entryPoint,
            packedQueuedOps: packUserOps(queuedUserOps),
            packedTargetOp: toPackedUserOp(userOp),
            stateOverride
        }
    }

    private async performBinarySearch({
        simulation,
        methodName,
        retryCount = 0,
        initialMinGas = 9_000n,
        gasAllowance
    }: {
        simulation: Simulation
        methodName:
            | "binarySearchVerificationGas"
            | "binarySearchPaymasterVerificationGas"
            | "binarySearchCallGas"
        retryCount?: number
        initialMinGas?: bigint
        gasAllowance?: bigint
    }): Promise<SimulateBinarySearchResult> {
        // Check if we've hit the retry limit
        if (retryCount > this.config.binarySearchMaxRetries) {
            this.logger.warn(
                { methodName, retryCount },
                "Max retries reached in binary search"
            )
            throw new Error(`Max retries reached when calling ${methodName}`)
        }

        try {
            const { result } = await simulation.pimlicoSimulation.simulate[
                methodName
            ](
                [
                    simulation.epSimulationsAddress,
                    simulation.entryPoint,
                    simulation.packedQueuedOps,
                    simulation.packedTargetOp,
                    initialMinGas,
                    this.config.binarySearchToleranceDelta,
                    gasAllowance ?? this.config.binarySearchGasAllowance
                ],
                {
                    stateOverride: simulation.stateOverride,
                    gas: this.config.fixedGasLimitForEstimation
                }
            )

            // Check if simulation ran out of gas
            if (result.resultType === BinarySearchResultType.OutOfGas) {
                const { optimalGas, minGas } = result.outOfGasData
                const newGasAllowance = optimalGas - minGas

                return await this.performBinarySearch({
                    simulation,
                    methodName,
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
                code: ERC7769Errors.UserOperationReverted
            }
        } catch (error) {
            const decoded = decodeSimulateHandleOpError(error, this.logger)

            if (decoded.result === "failed") {
                return {
                    result: "failed",
                    data: decoded.data,
                    code: decoded.code
                }
            }

            this.logger.warn(
                { err: error, methodName },
                "Error in performBinarySearch"
            )

            throw new Error("Error in performBinarySearch")
        }
    }

    private async simulateHandleOp(
        simulation: Simulation
    ): Promise<SimulateHandleOpResult> {
        try {
            const result =
                await simulation.pimlicoSimulation.simulate.simulateHandleOp(
                    [
                        simulation.epSimulationsAddress,
                        simulation.entryPoint,
                        simulation.packedQueuedOps,
                        simulation.packedTargetOp
                    ],
                    {
                        stateOverride: simulation.stateOverride,
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
            return decodeSimulateHandleOpError(error, this.logger)
        }
    }

    private async simulateAndEstimateGasLimits({
        simulation,
        retryCount = 0
    }: {
        simulation: Simulation
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
        try {
            const { result } =
                await simulation.pimlicoSimulation.simulate.simulateAndEstimateGas(
                    [
                        simulation.epSimulationsAddress,
                        simulation.entryPoint,
                        simulation.packedQueuedOps,
                        simulation.packedTargetOp,
                        9_000n,
                        this.config.binarySearchToleranceDelta,
                        this.config.binarySearchGasAllowance
                    ],
                    {
                        stateOverride: simulation.stateOverride,
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
                    simulation,
                    methodName: "binarySearchVerificationGas",
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
                    code: ERC7769Errors.UserOperationReverted
                }
            }

            // Check if paymaster verification gas limit needs retry
            let paymasterVerificationGas: bigint
            if (
                paymasterVerificationGasLimit.resultType ===
                BinarySearchResultType.OutOfGas
            ) {
                const binarySearchResult = await this.performBinarySearch({
                    simulation,
                    methodName: "binarySearchPaymasterVerificationGas",
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
                    code: ERC7769Errors.UserOperationReverted
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
            return decodedError as {
                result: "failed"
                data: string
                code: number
            }
        }
    }

    async simulateValidation({
        entryPoint,
        userOp,
        queuedUserOps
    }: {
        entryPoint: Address
        userOp: UserOperation07
        queuedUserOps: UserOperation07[]
    }) {
        const simulation = this.getSimulation({
            entryPoint,
            userOp,
            queuedUserOps,
            stateOverride: prepareStateOverride({
                userOps: [userOp],
                queuedUserOps,
                config: this.config
            })
        })

        try {
            const { result } =
                await simulation.pimlicoSimulation.simulate.simulateValidation(
                    [
                        simulation.epSimulationsAddress,
                        simulation.entryPoint,
                        simulation.packedQueuedOps,
                        simulation.packedTargetOp
                    ],
                    {
                        stateOverride: simulation.stateOverride,
                        gas: this.config.fixedGasLimitForEstimation
                    }
                )

            return {
                result: "validation",
                data: result
            }
        } catch (error) {
            return decodeSimulateHandleOpError(error, this.logger)
        }
    }

    async validateHandleOp07({
        entryPoint,
        userOp,
        queuedUserOps,
        stateOverrides = {}
    }: {
        entryPoint: Address
        userOp: UserOperation07
        queuedUserOps: UserOperation07[]
        stateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult> {
        const simulation = this.getSimulation({
            entryPoint,
            userOp,
            queuedUserOps,
            stateOverride: await prepareSimulationOverrides07({
                userOp,
                queuedUserOps,
                entryPoint,
                gasPriceManager: this.gasPriceManager,
                userStateOverrides: stateOverrides,
                config: this.config
            })
        })

        const result = await this.simulateHandleOp(simulation)
        if (result.result === "failed") {
            return result
        }

        return {
            result: "execution",
            data: {
                callGasLimit: 0n,
                verificationGasLimit: 0n,
                paymasterVerificationGasLimit: 0n,
                executionResult: result.data.executionResult
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
        userOp: UserOperation07
        queuedUserOps: UserOperation07[]
        userStateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult> {
        const simulation = this.getSimulation({
            entryPoint,
            userOp,
            queuedUserOps,
            stateOverride: await prepareSimulationOverrides07({
                userOp,
                queuedUserOps,
                entryPoint,
                gasPriceManager: this.gasPriceManager,
                userStateOverrides,
                config: this.config
            })
        })

        if (this.config.splitSimulationCalls) {
            const [sho, bsvgl, bspvgl, bscgl] = await Promise.all([
                this.simulateHandleOp(simulation),
                this.performBinarySearch({
                    simulation,
                    methodName: "binarySearchVerificationGas"
                }),
                this.performBinarySearch({
                    simulation,
                    methodName: "binarySearchPaymasterVerificationGas"
                }),
                this.performBinarySearch({
                    simulation,
                    methodName: "binarySearchCallGas"
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
        }

        const [saegl, focgl] = await Promise.all([
            this.simulateAndEstimateGasLimits({ simulation }),
            this.performBinarySearch({
                simulation,
                methodName: "binarySearchCallGas"
            })
        ])

        if (saegl.result === "failed") {
            return saegl
        }

        if (focgl.result === "failed") {
            return focgl
        }

        const { verificationGas, paymasterVerificationGas, executionResult } =
            saegl

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
