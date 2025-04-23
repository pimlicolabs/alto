import type { GasPriceManager } from "@alto/handlers"
import type {
    InterfaceValidator,
    StateOverrides,
    UserOperationV06,
    UserOperationV07,
    ValidationResult,
    ValidationResultV06,
    ValidationResultV07,
    ValidationResultWithAggregationV06,
    ValidationResultWithAggregationV07
} from "@alto/types"
import {
    type Address,
    EntryPointV06Abi,
    ExecutionErrors,
    type ExecutionResult,
    type ReferencedCodeHashes,
    RpcError,
    type StorageMap,
    type UserOperation,
    ValidationErrors,
    type ValidationResultWithAggregation,
    entryPointExecutionErrorSchemaV06,
    entryPointExecutionErrorSchemaV07
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import { calcPreVerificationGas, isVersion06 } from "@alto/utils"
import * as sentry from "@sentry/node"
import {
    BaseError,
    ContractFunctionExecutionError,
    getContract,
    pad,
    slice,
    toHex,
    zeroAddress
} from "viem"
import { fromZodError } from "zod-validation-error"
import { GasEstimationHandler } from "../estimation/gasEstimationHandler"
import type { SimulateHandleOpResult } from "../estimation/types"
import type { AltoConfig } from "../../createConfig"

export class UnsafeValidator implements InterfaceValidator {
    config: AltoConfig
    metrics: Metrics
    gasPriceManager: GasPriceManager
    logger: Logger
    gasEstimationHandler: GasEstimationHandler

    constructor({
        config,
        metrics,
        gasPriceManager
    }: {
        config: AltoConfig
        metrics: Metrics
        gasPriceManager: GasPriceManager
    }) {
        this.config = config
        this.metrics = metrics
        this.gasPriceManager = gasPriceManager
        this.logger = config.getLogger(
            { module: "validator" },
            {
                level: config.logLevel
            }
        )
        this.gasEstimationHandler = new GasEstimationHandler(config)
    }

    async getSimulationResult(
        isVersion06: boolean,
        errorResult: unknown,
        logger: Logger,
        simulationType: "validation" | "execution"
    ): Promise<
        ValidationResult | ValidationResultWithAggregation | ExecutionResult
    > {
        const entryPointExecutionErrorSchema = isVersion06
            ? entryPointExecutionErrorSchemaV06
            : entryPointExecutionErrorSchemaV07

        const entryPointErrorSchemaParsing =
            entryPointExecutionErrorSchema.safeParse(errorResult)

        if (!entryPointErrorSchemaParsing.success) {
            try {
                const err = fromZodError(entryPointErrorSchemaParsing.error)
                logger.error(
                    { error: err.message },
                    "unexpected error during valiation"
                )
                logger.error(JSON.stringify(errorResult))
                err.message = `User Operation simulation returned unexpected invalid response: ${err.message}`
                throw err
            } catch {
                if (errorResult instanceof BaseError) {
                    const revertError = errorResult.walk(
                        (err) => err instanceof ContractFunctionExecutionError
                    )
                    throw new RpcError(
                        `UserOperation reverted during simulation with reason: ${
                            // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
                            (revertError?.cause as any)?.reason
                        }`,
                        ValidationErrors.SimulateValidation
                    )
                }
                sentry.captureException(errorResult)
                throw new Error(
                    `User Operation simulation returned unexpected invalid response: ${JSON.stringify(
                        errorResult
                    )}`
                )
            }
        }

        const errorData = entryPointErrorSchemaParsing.data

        if (errorData.errorName === "FailedOp") {
            const reason = errorData.args.reason
            throw new RpcError(
                `UserOperation reverted during simulation with reason: ${reason}`,
                ValidationErrors.SimulateValidation
            )
        }

        if (simulationType === "validation") {
            if (
                errorData.errorName !== "ValidationResult" &&
                errorData.errorName !== "ValidationResultWithAggregation"
            ) {
                throw new Error(
                    "Unexpected error - errorName is not ValidationResult or ValidationResultWithAggregation"
                )
            }
        } else if (errorData.errorName !== "ExecutionResult") {
            throw new Error(
                "Unexpected error - errorName is not ExecutionResult"
            )
        }

        const simulationResult = errorData.args

        return simulationResult
    }

    async validateHandleOp({
        userOperation,
        entryPoint,
        queuedUserOperations,
        stateOverrides
    }: {
        userOperation: UserOperation
        entryPoint: Address
        queuedUserOperations: UserOperation[]
        stateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult<"execution">> {
        const error = await this.gasEstimationHandler.validateHandleOp({
            userOperation,
            queuedUserOperations,
            entryPoint,
            targetAddress: zeroAddress,
            targetCallData: "0x",
            stateOverrides
        })

        if (error.result === "failed") {
            let errorCode: number = ExecutionErrors.UserOperationReverted

            if (error.data.toString().includes("AA23")) {
                errorCode = ValidationErrors.SimulateValidation
            }

            throw new RpcError(
                `UserOperation reverted during simulation with reason: ${error.data}`,
                errorCode
            )
        }

        return error as SimulateHandleOpResult<"execution">
    }

    async getExecutionResult({
        userOperation,
        entryPoint,
        queuedUserOperations,
        stateOverrides
    }: {
        userOperation: UserOperation
        entryPoint: Address
        queuedUserOperations: UserOperation[]
        stateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult<"execution">> {
        const error = await this.gasEstimationHandler.simulateHandleOp({
            userOperation,
            queuedUserOperations,
            entryPoint,
            targetAddress: zeroAddress,
            targetCallData: "0x",
            stateOverrides
        })

        if (error.result === "failed") {
            let errorCode: number = ExecutionErrors.UserOperationReverted

            if (error.data.toString().includes("AA23")) {
                errorCode = ValidationErrors.SimulateValidation
            }

            throw new RpcError(
                `UserOperation reverted during simulation with reason: ${error.data}`,
                errorCode
            )
        }

        return error as SimulateHandleOpResult<"execution">
    }

    async getValidationResultV06({
        userOperation,
        entryPoint
    }: {
        userOperation: UserOperationV06
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        (ValidationResultV06 | ValidationResultWithAggregationV06) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        const entryPointContract = getContract({
            address: entryPoint,
            abi: EntryPointV06Abi,
            client: {
                public: this.config.publicClient
            }
        })

        const simulateValidationPromise = entryPointContract.simulate
            .simulateValidation([userOperation])
            .catch((e) => {
                if (e instanceof Error) {
                    return e
                }
                throw e
            })

        const runtimeValidationPromise =
            this.gasEstimationHandler.gasEstimatorV06.simulateHandleOpV06({
                entryPoint,
                userOperation,
                useCodeOverride: false, // disable code override so that call phase reverts aren't caught
                targetAddress: zeroAddress,
                targetCallData: "0x"
            })

        const [simulateValidationResult, runtimeValidation] = await Promise.all(
            [simulateValidationPromise, runtimeValidationPromise]
        )

        const validationResult = {
            ...((await this.getSimulationResult(
                isVersion06(userOperation),
                simulateValidationResult,
                this.logger,
                "validation"
            )) as ValidationResultV06 | ValidationResultWithAggregationV06),
            storageMap: {}
        }

        if (validationResult.returnInfo.sigFailed) {
            throw new RpcError(
                "Invalid UserOperation signature or paymaster signature",
                ValidationErrors.InvalidSignature
            )
        }

        const now = Date.now() / 1000

        this.logger.debug({
            validAfter: validationResult.returnInfo.validAfter,
            validUntil: validationResult.returnInfo.validUntil,
            now
        })

        if (
            validationResult.returnInfo.validAfter > now &&
            this.config.expirationCheck
        ) {
            throw new RpcError(
                "User operation is not valid yet",
                ValidationErrors.ExpiresShortly
            )
        }

        if (
            this.config.expirationCheck &&
            validationResult.returnInfo.validUntil < now + 5
        ) {
            throw new RpcError(
                "expires too soon",
                ValidationErrors.ExpiresShortly
            )
        }

        // validate runtime
        if (runtimeValidation.result === "failed") {
            throw new RpcError(
                `UserOperation reverted during simulation with reason: ${runtimeValidation.data}`,
                ValidationErrors.SimulateValidation
            )
        }

        return validationResult
    }

    parseValidationData(validationData: bigint): {
        aggregator: string
        validAfter: number
        validUntil: number
    } {
        const maxUint48 = 2 ** 48 - 1
        const data = pad(toHex(validationData), { size: 32 })

        // string offsets start from left (msb)
        const aggregator = slice(data, 32 - 20)
        let validUntil = Number.parseInt(slice(data, 32 - 26, 32 - 20), 16)
        if (validUntil === 0) {
            validUntil = maxUint48
        }
        const validAfter = Number.parseInt(slice(data, 0, 6), 16)

        return {
            aggregator,
            validAfter,
            validUntil
        }
    }

    mergeValidationData(
        accountValidationData: {
            aggregator: string
            validAfter: number
            validUntil: number
        },
        paymasterValidationData: {
            aggregator: string
            validAfter: number
            validUntil: number
        }
    ): {
        paymasterSigFailed: boolean
        accountSigFailed: boolean
        validAfter: number
        validUntil: number
    } {
        return {
            paymasterSigFailed:
                paymasterValidationData.aggregator !== zeroAddress,
            accountSigFailed: accountValidationData.aggregator !== zeroAddress,
            validAfter: Math.max(
                accountValidationData.validAfter,
                paymasterValidationData.validAfter
            ),
            validUntil: Math.min(
                accountValidationData.validUntil,
                paymasterValidationData.validUntil
            )
        }
    }

    mergeValidationDataValues(
        accountValidationData: bigint,
        paymasterValidationData: bigint
    ): {
        paymasterSigFailed: boolean
        accountSigFailed: boolean
        validAfter: number
        validUntil: number
    } {
        return this.mergeValidationData(
            this.parseValidationData(accountValidationData),
            this.parseValidationData(paymasterValidationData)
        )
    }

    async getValidationResultV07({
        userOperation,
        queuedUserOperations,
        entryPoint
    }: {
        userOperation: UserOperationV07
        queuedUserOperations: UserOperationV07[]
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        (ValidationResultV07 | ValidationResultWithAggregationV07) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        const { simulateValidationResult } =
            await this.gasEstimationHandler.gasEstimatorV07.simulateValidation({
                entryPoint,
                userOperation,
                queuedUserOperations
            })

        if (simulateValidationResult.status === "failed") {
            throw new RpcError(
                `UserOperation reverted with reason: ${
                    simulateValidationResult.data as string
                }`,
                ValidationErrors.SimulateValidation
            )
        }

        const validationResult =
            simulateValidationResult.data as ValidationResultWithAggregationV07

        const mergedValidation = this.mergeValidationDataValues(
            validationResult.returnInfo.accountValidationData,
            validationResult.returnInfo.paymasterValidationData
        )

        const res = {
            returnInfo: {
                ...validationResult.returnInfo,
                accountSigFailed: mergedValidation.accountSigFailed,
                paymasterSigFailed: mergedValidation.paymasterSigFailed,
                validUntil: mergedValidation.validUntil,
                validAfter: mergedValidation.validAfter
            },
            senderInfo: {
                ...validationResult.senderInfo,
                addr: userOperation.sender
            },
            factoryInfo:
                userOperation.factory && validationResult.factoryInfo
                    ? {
                          ...validationResult.factoryInfo,
                          addr: userOperation.factory
                      }
                    : undefined,
            paymasterInfo:
                userOperation.paymaster && validationResult.paymasterInfo
                    ? {
                          ...validationResult.paymasterInfo,
                          addr: userOperation.paymaster
                      }
                    : undefined,
            aggregatorInfo: validationResult.aggregatorInfo,
            storageMap: {}
        }

        // this.validateStorageAccessList(userOperation, res, accessList)

        if (res.returnInfo.accountSigFailed) {
            throw new RpcError(
                "Invalid UserOp signature",
                ValidationErrors.InvalidSignature
            )
        }

        if (res.returnInfo.paymasterSigFailed) {
            throw new RpcError(
                "Invalid UserOp paymasterData",
                ValidationErrors.InvalidSignature
            )
        }

        const now = Math.floor(Date.now() / 1000)

        if (res.returnInfo.validAfter > now) {
            throw new RpcError(
                `User operation is not valid yet, validAfter=${res.returnInfo.validAfter}, now=${now}`,
                ValidationErrors.ExpiresShortly
            )
        }

        if (
            this.config.expirationCheck &&
            (res.returnInfo.validUntil == null ||
                res.returnInfo.validUntil < now + 5)
        ) {
            throw new RpcError(
                `UserOperation expires too soon, validUntil=${res.returnInfo.validUntil}, now=${now}`,
                ValidationErrors.ExpiresShortly
            )
        }

        return res
    }

    getValidationResult({
        userOperation,
        queuedUserOperations,
        entryPoint,
        codeHashes
    }: {
        userOperation: UserOperation
        queuedUserOperations: UserOperation[]
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        if (isVersion06(userOperation)) {
            return this.getValidationResultV06({
                userOperation,
                entryPoint,
                codeHashes
            })
        }
        return this.getValidationResultV07({
            userOperation,
            queuedUserOperations: queuedUserOperations as UserOperationV07[],
            entryPoint
        })
    }

    async validatePreVerificationGas({
        userOperation,
        entryPoint
    }: {
        userOperation: UserOperation
        entryPoint: Address
    }) {
        const preVerificationGas = await calcPreVerificationGas({
            config: this.config,
            userOperation,
            entryPoint,
            gasPriceManager: this.gasPriceManager,
            validate: true
        })

        if (preVerificationGas > userOperation.preVerificationGas) {
            throw new RpcError(
                `preVerificationGas is not enough, required: ${preVerificationGas}, got: ${userOperation.preVerificationGas}`,
                ValidationErrors.SimulateValidation
            )
        }
    }

    async validateUserOperation({
        userOperation,
        queuedUserOperations,
        entryPoint
    }: {
        userOperation: UserOperation
        queuedUserOperations: UserOperation[]
        entryPoint: Address
        _referencedContracts?: ReferencedCodeHashes
    }): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        try {
            const validationResult = await this.getValidationResult({
                userOperation,
                queuedUserOperations,
                entryPoint
            })

            this.metrics.userOperationsValidationSuccess.inc()

            return validationResult
        } catch (e) {
            // console.log(e)
            this.metrics.userOperationsValidationFailure.inc()
            throw e
        }
    }
}
