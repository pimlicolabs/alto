import type { GasPriceManager } from "@alto/handlers"
import {
    ERC7769Errors,
    RpcError,
    type StateOverrides,
    type UserOperation07,
    pimlicoSimulationsAbi
} from "@alto/types"
import { type Logger, isVersion08, toPackedUserOp } from "@alto/utils"
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

    private getSimulationContracts(
        entryPoint: Address,
        userOp: UserOperation07
    ) {
        const is08 = isVersion08(userOp, entryPoint)
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
                ERC7769Errors.InvalidFields
            )
        }

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
        queuedUserOps: UserOperation07[]
        targetUserOp: UserOperation07
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
            throw new Error(`Max retries reached when calling ${methodName}`)
        }

        const packedQueuedOps = packUserOps(queuedUserOps)
        const packedTargetOp = toPackedUserOp(targetUserOp)

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

    private async simulateHandleOp({
        entryPoint,
        queuedUserOps,
        targetUserOp,
        stateOverride
    }: {
        entryPoint: Address
        queuedUserOps: UserOperation07[]
        targetUserOp: UserOperation07
        stateOverride?: StateOverride
    }): Promise<SimulateHandleOpResult> {
        const { pimlicoSimulation, epSimulationsAddress } =
            this.getSimulationContracts(entryPoint, targetUserOp)

        const packedQueuedOps = packUserOps(queuedUserOps)
        const packedTargetOp = toPackedUserOp(targetUserOp)

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
            return decodeSimulateHandleOpError(error, this.logger)
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
        queuedUserOps: UserOperation07[]
        targetUserOp: UserOperation07
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
        const packedTargetOp = toPackedUserOp(targetUserOp)

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
        const { epSimulationsAddress, pimlicoSimulation } =
            this.getSimulationContracts(entryPoint, userOp)

        const viemStateOverride = prepareStateOverride({
            userOps: [userOp],
            queuedUserOps,
            config: this.config
        })

        try {
            const { result } =
                await pimlicoSimulation.simulate.simulateValidation(
                    [
                        epSimulationsAddress,
                        entryPoint,
                        packUserOps(queuedUserOps),
                        toPackedUserOp(userOp)
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
        const { epSimulationsAddress, pimlicoSimulation } =
            this.getSimulationContracts(entryPoint, userOp)

        const viemStateOverride = await prepareSimulationOverrides07({
            userOp,
            queuedUserOps,
            entryPoint,
            gasPriceManager: this.gasPriceManager,
            userStateOverrides: stateOverrides,
            config: this.config
        })

        try {
            const { result } =
                await pimlicoSimulation.simulate.simulateHandleOp(
                    [
                        epSimulationsAddress,
                        entryPoint,
                        packUserOps(queuedUserOps),
                        toPackedUserOp(userOp)
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
            return decodeSimulateHandleOpError(error, this.logger)
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
        const viemStateOverride = await prepareSimulationOverrides07({
            userOp,
            queuedUserOps,
            entryPoint,
            gasPriceManager: this.gasPriceManager,
            userStateOverrides: userStateOverrides,
            config: this.config
        })

        if (this.config.splitSimulationCalls) {
            const [sho, bsvgl, bspvgl, bscgl] = await Promise.all([
                this.simulateHandleOp({
                    entryPoint,
                    queuedUserOps,
                    targetUserOp: userOp,
                    stateOverride: viemStateOverride
                }),
                this.performBinarySearch({
                    entryPoint,
                    methodName: "binarySearchVerificationGas",
                    queuedUserOps,
                    targetUserOp: userOp,
                    stateOverride: viemStateOverride
                }),
                this.performBinarySearch({
                    entryPoint,
                    methodName: "binarySearchPaymasterVerificationGas",
                    queuedUserOps,
                    targetUserOp: userOp,
                    stateOverride: viemStateOverride
                }),
                this.performBinarySearch({
                    entryPoint,
                    methodName: "binarySearchCallGas",
                    queuedUserOps,
                    targetUserOp: userOp,
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
        }

        const [saegl, focgl] = await Promise.all([
            this.simulateAndEstimateGasLimits({
                entryPoint,
                queuedUserOps,
                targetUserOp: userOp,
                stateOverride: viemStateOverride
            }),
            this.performBinarySearch({
                entryPoint,
                methodName: "binarySearchCallGas",
                queuedUserOps,
                targetUserOp: userOp,
                stateOverride: viemStateOverride
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
