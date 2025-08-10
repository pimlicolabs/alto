import type { GasPriceManager } from "@alto/handlers"
import type {
    InterfaceValidator,
    StateOverrides,
    UserOperation06,
    UserOperation07,
    ValidationResult,
    ValidationResult06,
    ValidationResult07
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
    entryPointExecutionErrorSchema06,
    entryPointExecutionErrorSchema07
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import { isVersion06 } from "@alto/utils"
import * as sentry from "@sentry/node"
import {
    BaseError,
    ContractFunctionExecutionError,
    type StateOverride,
    getContract,
    pad,
    slice,
    toHex,
    zeroAddress
} from "viem"
import { fromZodError } from "zod-validation-error"
import type { AltoConfig } from "../../createConfig"
import { getEip7702DelegationOverrides } from "../../utils/eip7702"
import { GasEstimationHandler } from "../estimation/gasEstimationHandler"
import type { SimulateHandleOpResult } from "../estimation/types"

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
        this.gasEstimationHandler = new GasEstimationHandler(
            config,
            gasPriceManager
        )
    }

    async getSimulationResult(
        isVersion06: boolean,
        errorResult: unknown,
        logger: Logger,
        simulationType: "validation" | "execution"
    ): Promise<ValidationResult | ExecutionResult> {
        const entryPointExecutionErrorSchema = isVersion06
            ? entryPointExecutionErrorSchema06
            : entryPointExecutionErrorSchema07

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

    async validateHandleOp(args: {
        userOp: UserOperation
        entryPoint: Address
        queuedUserOps: UserOperation[]
        stateOverrides?: StateOverrides
    }) {
        const { userOp, entryPoint, queuedUserOps, stateOverrides } = args
        const error = await this.gasEstimationHandler.validateHandleOp({
            userOp,
            queuedUserOps,
            entryPoint,
            targetAddress: zeroAddress,
            targetCallData: "0x",
            stateOverrides
        })

        let { callGasLimit, verificationGasLimit } = userOp
        let paymasterVerificationGasLimit =
            "paymasterVerificationGasLimit" in userOp
                ? userOp.paymasterVerificationGasLimit
                : null
        // Check if userOperation passes without estimation balance overrides (will throw error if it fails validation)
        // the errors we are looking for are:
        // 1. AA31 paymaster deposit too low
        // 2. AA21 didn't pay prefund
        if (error.result === "failed") {
            const data = error.data.toString()

            if (data.includes("AA31") || data.includes("AA21")) {
                throw new RpcError(
                    `UserOperation reverted during simulation with reason: ${error.data}`,
                    ExecutionErrors.UserOperationReverted
                )
            }

            this.metrics.altoSecondValidationFailed.inc()

            this.logger.warn(
                { data },
                "Second validation during eth_estimateUserOperationGas led to a failure"
            )

            // we always have to double the call gas limits as other gas limits happen
            // before we even get to callGasLimit
            callGasLimit *= 2n
            const isPaymasterError =
                data.includes("AA33") || data.includes("AA36")

            const isVerificationError =
                data.includes("AA23") ||
                data.includes("AA13") ||
                data.includes("AA26") ||
                data.includes("AA40") ||
                data.includes("AA41")

            if (isPaymasterError && paymasterVerificationGasLimit) {
                // paymasterVerificationGasLimit out of gas errors
                paymasterVerificationGasLimit *= 2n
            } else if (isVerificationError) {
                // verificationGasLimit out of gas errors
                verificationGasLimit *= 2n
                // we need to increase paymaster fields because they will be
                // caught after verification gas limit errors
                if (paymasterVerificationGasLimit) {
                    paymasterVerificationGasLimit *= 2n
                }
            }
        }

        return {
            callGasLimit: callGasLimit,
            verificationGasLimit: verificationGasLimit,
            paymasterVerificationGasLimit: paymasterVerificationGasLimit,
            paymasterPostOpGasLimit:
                "paymasterPostOpGasLimit" in userOp
                    ? userOp.paymasterPostOpGasLimit
                    : null
        }
    }

    async getExecutionResult(args: {
        userOp: UserOperation
        entryPoint: Address
        queuedUserOps: UserOperation[]
        stateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult> {
        const { userOp, entryPoint, queuedUserOps, stateOverrides } = args
        const error = await this.gasEstimationHandler.simulateHandleOp({
            userOp,
            queuedUserOps,
            entryPoint,
            targetAddress: zeroAddress,
            targetCallData: "0x",
            stateOverrides
        })

        if (error.result === "failed") {
            let errorCode: number = ExecutionErrors.UserOperationReverted

            if (error.data.toString().includes("AA23")) {
                errorCode = ValidationErrors.SimulateValidation

                return {
                    result: "failed",
                    data: error.data,
                    code: errorCode
                }
            }

            return {
                result: "failed",
                data: `UserOperation reverted during simulation with reason: ${error.data}`,
                code: errorCode
            }
        }

        return error
    }

    async getValidationResultV06(args: {
        userOp: UserOperation06
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        ValidationResult06 & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        const { userOp, entryPoint } = args
        const entryPointContract = getContract({
            address: entryPoint,
            abi: EntryPointV06Abi,
            client: {
                public: this.config.publicClient
            }
        })

        let eip7702Override: StateOverride | undefined
        if (userOp.eip7702Auth) {
            eip7702Override = getEip7702DelegationOverrides([userOp])
        }

        const simulateValidationPromise = entryPointContract.simulate
            .simulateValidation(
                [userOp],
                eip7702Override ? { stateOverride: eip7702Override } : {}
            )
            .catch((e) => {
                if (e instanceof Error) {
                    return e
                }
                throw e
            })

        const runtimeValidationPromise =
            this.gasEstimationHandler.gasEstimator06.simulateHandleOp06({
                entryPoint,
                userOp,
                useCodeOverride: false, // disable code override so that call phase reverts aren't caught
                targetAddress: zeroAddress,
                targetCallData: "0x"
            })

        const [simulateValidationResult, runtimeValidation] = await Promise.all(
            [simulateValidationPromise, runtimeValidationPromise]
        )

        const validationResult = {
            ...((await this.getSimulationResult(
                isVersion06(userOp),
                simulateValidationResult,
                this.logger,
                "validation"
            )) as ValidationResult06),
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

    async getValidationResultV07(args: {
        userOp: UserOperation07
        queuedUserOps: UserOperation07[]
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        ValidationResult07 & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        const { userOp, queuedUserOps, entryPoint } = args

        const simulateValidationResult =
            await this.gasEstimationHandler.gasEstimator07.simulateValidation({
                entryPoint,
                userOp,
                queuedUserOps
            })

        if (simulateValidationResult.result === "failed") {
            throw new RpcError(
                `UserOperation reverted with reason: ${
                    simulateValidationResult.data as string
                }`,
                ValidationErrors.SimulateValidation
            )
        }

        const validationResult =
            simulateValidationResult.data as ValidationResult07

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
                addr: userOp.sender
            },
            factoryInfo:
                userOp.factory && validationResult.factoryInfo
                    ? {
                          ...validationResult.factoryInfo,
                          addr: userOp.factory
                      }
                    : undefined,
            paymasterInfo:
                userOp.paymaster && validationResult.paymasterInfo
                    ? {
                          ...validationResult.paymasterInfo,
                          addr: userOp.paymaster
                      }
                    : undefined,
            aggregatorInfo: validationResult.aggregatorInfo,
            storageMap: {}
        }

        // this.validateStorageAccessList(userOp, res, accessList)

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

    getValidationResult(args: {
        userOp: UserOperation
        queuedUserOps: UserOperation[]
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        ValidationResult & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        const { userOp, queuedUserOps, entryPoint, codeHashes } = args
        if (isVersion06(userOp)) {
            return this.getValidationResultV06({
                userOp,
                entryPoint,
                codeHashes
            })
        }
        return this.getValidationResultV07({
            userOp,
            queuedUserOps: queuedUserOps as UserOperation07[],
            entryPoint
        })
    }

    async validateUserOp(args: {
        userOp: UserOperation
        queuedUserOps: UserOperation[]
        entryPoint: Address
        _referencedContracts?: ReferencedCodeHashes
    }): Promise<
        ValidationResult & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        const { userOp, queuedUserOps, entryPoint } = args
        try {
            const validationResult = await this.getValidationResult({
                userOp,
                queuedUserOps,
                entryPoint
            })

            this.metrics.userOpsValidationSuccess.inc()

            return validationResult
        } catch (e) {
            // console.log(e)
            this.metrics.userOpsValidationFailure.inc()
            throw e
        }
    }
}
