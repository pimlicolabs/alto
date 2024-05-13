import type {
    ChainType,
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
    entryPointErrorsSchema,
    entryPointExecutionErrorSchemaV06,
    entryPointExecutionErrorSchemaV07
} from "@alto/types"
import type { GasPriceManager, Logger, Metrics } from "@alto/utils"
import {
    calcPreVerificationGas,
    calcVerificationGasAndCallGasLimit,
    isVersion06,
    isVersion07
} from "@alto/utils"
import * as sentry from "@sentry/node"
import {
    BaseError,
    type Chain,
    ContractFunctionExecutionError,
    type PublicClient,
    type Transport,
    getContract,
    pad,
    slice,
    toHex,
    zeroAddress
} from "viem"
import { fromZodError } from "zod-validation-error"
import { simulateValidation } from "../EntryPointSimulationsV07"
import {
    type SimulateHandleOpResult,
    simulateHandleOp,
    simulateHandleOpV06
} from "../gasEstimation"

async function getSimulationResult(
    isVersion06: boolean,
    errorResult: unknown,
    logger: Logger,
    simulationType: "validation" | "execution",
    usingTenderly = false
): Promise<
    ValidationResult | ValidationResultWithAggregation | ExecutionResult
> {
    const entryPointExecutionErrorSchema = isVersion06
        ? entryPointExecutionErrorSchemaV06
        : entryPointExecutionErrorSchemaV07

    const entryPointErrorSchemaParsing = usingTenderly
        ? entryPointErrorsSchema.safeParse(errorResult)
        : entryPointExecutionErrorSchema.safeParse(errorResult)

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
                `User Operation simulation returned unexpected invalid response: ${errorResult}`
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
        throw new Error("Unexpected error - errorName is not ExecutionResult")
    }

    const simulationResult = errorData.args

    return simulationResult
}

export class UnsafeValidator implements InterfaceValidator {
    publicClient: PublicClient<Transport, Chain>
    logger: Logger
    metrics: Metrics
    usingTenderly: boolean
    balanceOverrideEnabled: boolean
    expirationCheck: boolean
    chainId: number
    gasPriceManager: GasPriceManager
    entryPointSimulationsAddress?: Address
    chainType: ChainType

    constructor(
        publicClient: PublicClient<Transport, Chain>,
        logger: Logger,
        metrics: Metrics,
        gasPriceManager: GasPriceManager,
        chainType: ChainType,
        entryPointSimulationsAddress?: Address,
        usingTenderly = false,
        balanceOverrideEnabled = false,
        expirationCheck = true
    ) {
        this.publicClient = publicClient
        this.logger = logger
        this.metrics = metrics
        this.usingTenderly = usingTenderly
        this.balanceOverrideEnabled = balanceOverrideEnabled
        this.expirationCheck = expirationCheck
        this.chainId = publicClient.chain.id
        this.gasPriceManager = gasPriceManager
        this.entryPointSimulationsAddress = entryPointSimulationsAddress
        this.chainType = chainType
    }

    async getExecutionResult(
        userOperation: UserOperation,
        entryPoint: Address,
        queuedUserOperations: UserOperation[],
        stateOverrides?: StateOverrides,
    ): Promise<SimulateHandleOpResult<"execution">> {
        const error = await simulateHandleOp(
            userOperation,
            queuedUserOperations,
            entryPoint,
            this.publicClient,
            false,
            zeroAddress,
            "0x",
            this.balanceOverrideEnabled,
            stateOverrides,
            this.entryPointSimulationsAddress
        )

        if (error.result === "failed") {
            throw new RpcError(
                `UserOperation reverted during simulation with reason: ${error.data}`,
                ExecutionErrors.UserOperationReverted
            )
        }

        return error as SimulateHandleOpResult<"execution">
    }

    async getValidationResultV06(
        userOperation: UserOperationV06,
        entryPoint: Address,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResultV06 | ValidationResultWithAggregationV06) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        const entryPointContract = getContract({
            address: entryPoint,
            abi: EntryPointV06Abi,
            client: {
                public: this.publicClient
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

        const runtimeValidationPromise = simulateHandleOpV06(
            userOperation,
            entryPoint,
            this.publicClient,
            zeroAddress,
            "0x"
        )

        const [simulateValidationResult, runtimeValidation] = await Promise.all(
            [simulateValidationPromise, runtimeValidationPromise]
        )

        const validationResult = {
            ...((await getSimulationResult(
                isVersion06(userOperation),
                simulateValidationResult,
                this.logger,
                "validation",
                this.usingTenderly
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
            validationResult.returnInfo.validAfter > now - 5 &&
            this.expirationCheck
        ) {
            throw new RpcError(
                "User operation is not valid yet",
                ValidationErrors.ExpiresShortly
            )
        }

        if (
            validationResult.returnInfo.validUntil < now + 30 &&
            this.expirationCheck
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

    async getValidationResultV07(
        userOperation: UserOperationV07,
        queuedUserOperations: UserOperationV07[],
        entryPoint: Address,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResultV07 | ValidationResultWithAggregationV07) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        if (!this.entryPointSimulationsAddress) {
            throw new Error("entryPointSimulationsAddress is not set")
        }

        const { simulateValidationResult } = await simulateValidation(
            userOperation,
            queuedUserOperations,
            entryPoint,
            this.publicClient,
            this.entryPointSimulationsAddress
        )

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

        if (res.returnInfo.validAfter > now - 5) {
            throw new RpcError(
                `User operation is not valid yet, validAfter=${res.returnInfo.validAfter}, now=${now}`,
                ValidationErrors.ExpiresShortly
            )
        }

        if (
            res.returnInfo.validUntil == null ||
            res.returnInfo.validUntil < now + 30
        ) {
            throw new RpcError(
                `UserOperation expires too soon, validUntil=${res.returnInfo.validUntil}, now=${now}`,
                ValidationErrors.ExpiresShortly
            )
        }

        return res
    }

    getValidationResult(
        userOperation: UserOperation,
        queuedUserOperations: UserOperation[],
        entryPoint: Address,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {

        if (isVersion06(userOperation)) {
            return this.getValidationResultV06(
                userOperation,
                entryPoint,
                _codeHashes
            )
        }
        return this.getValidationResultV07(
            userOperation,
            queuedUserOperations as UserOperationV07[],
            entryPoint,
            _codeHashes
        )
    }

    async validatePreVerificationGas(
        userOperation: UserOperation,
        entryPoint: Address
    ) {
        const preVerificationGas = await calcPreVerificationGas(
            this.publicClient,
            userOperation,
            entryPoint,
            this.chainId,
            this.chainType,
            this.gasPriceManager,
            true
        )

        if (preVerificationGas > userOperation.preVerificationGas) {
            throw new RpcError(
                `preVerificationGas is not enough, required: ${preVerificationGas}, got: ${userOperation.preVerificationGas}`,
                ValidationErrors.SimulateValidation
            )
        }
    }

    async validateUserOperation(
        shouldCheckPrefund: boolean,
        userOperation: UserOperation,
        queuedUserOperations: UserOperation[],
        entryPoint: Address,
        _referencedContracts?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        try {
            const validationResult = await this.getValidationResult(
                userOperation,
                queuedUserOperations,
                entryPoint
            )

            if (shouldCheckPrefund) {
                const prefund = validationResult.returnInfo.prefund

                const { verificationGasLimit, callGasLimit } =
                    calcVerificationGasAndCallGasLimit(
                        userOperation,
                        {
                            preOpGas: validationResult.returnInfo.preOpGas,
                            paid: validationResult.returnInfo.prefund
                        },
                        this.chainId
                    )

                let mul = 1n

                if (
                    isVersion06(userOperation) &&
                    userOperation.paymasterAndData
                ) {
                    mul = 3n
                }

                if (
                    isVersion07(userOperation) &&
                    userOperation.paymaster === "0x"
                ) {
                    mul = 3n
                }

                const requiredPreFund =
                    callGasLimit +
                    verificationGasLimit * mul +
                    userOperation.preVerificationGas

                if (requiredPreFund > prefund) {
                    throw new RpcError(
                        `prefund is not enough, required: ${requiredPreFund}, got: ${prefund}`,
                        ValidationErrors.SimulateValidation
                    )
                }

                // TODO prefund should be greater than it costs us to add it to mempool
            }

            this.metrics.userOperationsValidationSuccess.inc()

            return validationResult
        } catch (e) {
            // console.log(e)
            this.metrics.userOperationsValidationFailure.inc()
            throw e
        }
    }
}
