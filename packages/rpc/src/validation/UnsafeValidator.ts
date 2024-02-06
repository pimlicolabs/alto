import {
    type Address,
    EntryPointAbi,
    ExecutionErrors,
    type ExecutionResult,
    type ReferencedCodeHashes,
    RpcError,
    type StorageMap,
    type UserOperation,
    ValidationErrors,
    type ValidationResultWithAggregation,
    entryPointErrorsSchema,
    entryPointExecutionErrorSchema
} from "@alto/types"
import type { ValidationResult } from "@alto/types"
import { hexDataSchema } from "@alto/types"
import type { IValidator } from "@alto/types"
import type { StateOverrides } from "@alto/types"
import type { ApiVersion } from "@alto/types/src"
import { type Logger, type Metrics, calcPreVerificationGas } from "@alto/utils"
import { calcVerificationGasAndCallGasLimit } from "@alto/utils"
import * as sentry from "@sentry/node"
import {
    type Account,
    BaseError,
    type Chain,
    ContractFunctionExecutionError,
    type PublicClient,
    type Transport,
    decodeErrorResult,
    encodeFunctionData,
    getContract,
    zeroAddress
} from "viem"
import { z } from "zod"
import { fromZodError } from "zod-validation-error"
import { simulateHandleOp } from "../gasEstimation"

// let id = 0

async function simulateTenderlyCall(publicClient: PublicClient, params: any) {
    const response = await publicClient.transport
        .request({ method: "eth_call", params })
        .catch((e) => {
            return e
        })

    const parsedObject = z
        .object({
            cause: z.object({
                data: hexDataSchema
            })
        })
        .parse(response)

    return parsedObject.cause.data
}

async function getSimulationResult(
    errorResult: unknown,
    logger: Logger,
    simulationType: "validation" | "execution",
    usingTenderly = false
): Promise<
    ValidationResult | ValidationResultWithAggregation | ExecutionResult
> {
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

export class UnsafeValidator implements IValidator {
    publicClient: PublicClient<Transport, Chain>
    entryPoint: Address
    logger: Logger
    metrics: Metrics
    utilityWallet: Account
    usingTenderly: boolean
    balanceOverrideEnabled: boolean
    apiVersion: ApiVersion
    chainId: number

    constructor(
        publicClient: PublicClient<Transport, Chain>,
        entryPoint: Address,
        logger: Logger,
        metrics: Metrics,
        utilityWallet: Account,
        apiVersion: ApiVersion,
        usingTenderly = false,
        balanceOverrideEnabled = false
    ) {
        this.publicClient = publicClient
        this.entryPoint = entryPoint
        this.logger = logger
        this.metrics = metrics
        this.utilityWallet = utilityWallet
        this.usingTenderly = usingTenderly
        this.balanceOverrideEnabled = balanceOverrideEnabled
        this.apiVersion = apiVersion
        this.chainId = publicClient.chain.id
    }

    async getExecutionResult(
        userOperation: UserOperation,
        stateOverrides?: StateOverrides
    ): Promise<ExecutionResult> {
        const entryPointContract = getContract({
            address: this.entryPoint,
            abi: EntryPointAbi,
            publicClient: this.publicClient
        })

        if (this.usingTenderly) {
            const tenderlyResult = await simulateTenderlyCall(
                this.publicClient,
                [
                    {
                        to: this.entryPoint,
                        data: encodeFunctionData({
                            abi: entryPointContract.abi,
                            functionName: "simulateHandleOp",
                            args: [
                                userOperation,
                                "0x0000000000000000000000000000000000000000",
                                "0x"
                            ]
                        })
                    },
                    "latest"
                ]
            )

            const errorResult = decodeErrorResult({
                abi: entryPointContract.abi,
                data: tenderlyResult
            })

            return getSimulationResult(
                errorResult,
                this.logger,
                "execution",
                this.usingTenderly
            ) as Promise<ExecutionResult>
        }

        if (this.balanceOverrideEnabled) {
            const error = await simulateHandleOp(
                userOperation,
                this.entryPoint,
                this.publicClient,
                false,
                zeroAddress,
                "0x",
                stateOverrides
            )

            if (error.result === "failed") {
                throw new RpcError(
                    `UserOperation reverted during simulation with reason: ${error.data}`,
                    ExecutionErrors.UserOperationReverted
                )
            }

            return error.data
        }

        const errorResult = await entryPointContract.simulate
            .simulateHandleOp(
                [
                    userOperation,
                    "0x0000000000000000000000000000000000000000",
                    "0x"
                ],
                {
                    account: this.utilityWallet
                }
            )
            .catch((e) => {
                if (e instanceof Error) {
                    return e
                }
                throw e
            })

        console.log("errorResult ==========> ", errorResult)

        return getSimulationResult(
            errorResult,
            this.logger,
            "execution",
            this.usingTenderly
        ) as Promise<ExecutionResult>
    }

    async getValidationResult(
        userOperation: UserOperation,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        const entryPointContract = getContract({
            address: this.entryPoint,
            abi: EntryPointAbi,
            publicClient: this.publicClient
        })

        if (this.usingTenderly) {
            const tenderlyResult = await simulateTenderlyCall(
                this.publicClient,
                [
                    {
                        to: this.entryPoint,
                        data: encodeFunctionData({
                            abi: entryPointContract.abi,
                            functionName: "simulateValidation",
                            args: [userOperation]
                        })
                    },
                    "latest"
                ]
            )

            const errorResult = decodeErrorResult({
                abi: entryPointContract.abi,
                data: tenderlyResult
            })

            return {
                ...((await getSimulationResult(
                    errorResult,
                    this.logger,
                    "validation",
                    this.usingTenderly
                )) as ValidationResult | ValidationResultWithAggregation),
                storageMap: {}
            }
        }

        const errorResult = await entryPointContract.simulate
            .simulateValidation([userOperation])
            .catch((e) => {
                if (e instanceof Error) {
                    return e
                }
                throw e
            })

        return {
            ...((await getSimulationResult(
                errorResult,
                this.logger,
                "validation",
                this.usingTenderly
            )) as ValidationResult | ValidationResultWithAggregation),
            storageMap: {}
        }
    }

    async validateUserOperation(
        userOperation: UserOperation,
        _referencedContracts?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        try {
            const validationResult =
                await this.getValidationResult(userOperation)

            if (validationResult.returnInfo.sigFailed) {
                throw new RpcError(
                    "Invalid UserOp signature or  paymaster signature",
                    ValidationErrors.InvalidSignature
                )
            }

            if (
                validationResult.returnInfo.validUntil <
                Date.now() / 1000 + 30
            ) {
                throw new RpcError(
                    "expires too soon",
                    ValidationErrors.ExpiresShortly
                )
            }

            if (this.apiVersion !== "v1") {
                const prefund = validationResult.returnInfo.prefund

                const preVerificationGas = await calcPreVerificationGas(
                    this.publicClient,
                    userOperation,
                    this.entryPoint,
                    this.chainId,
                    this.logger
                )

                const [verificationGasLimit, callGasLimit] =
                    await calcVerificationGasAndCallGasLimit(
                        this.publicClient,
                        userOperation,
                        {
                            preOpGas: validationResult.returnInfo.preOpGas,
                            paid: validationResult.returnInfo.prefund
                        },
                        this.chainId
                    )

                const mul = userOperation.paymasterAndData === "0x" ? 3n : 1n

                const requiredPreFund =
                    callGasLimit +
                    verificationGasLimit * mul +
                    preVerificationGas

                if (preVerificationGas > userOperation.preVerificationGas) {
                    throw new RpcError(
                        `preVerificationGas is not enough, required: ${preVerificationGas}, got: ${userOperation.preVerificationGas}`,
                        ValidationErrors.SimulateValidation
                    )
                }

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
