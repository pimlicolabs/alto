import type { Metrics } from "@alto/utils"
import {
    type Address,
    type ExecutionResult,
    type ReferencedCodeHashes,
    RpcError,
    type StorageMap,
    ValidationErrors,
    type ValidationResultWithAggregation
} from "@entrypoint-0.7/types"
import type {
    UnPackedUserOperation,
    ValidationResult
} from "@entrypoint-0.7/types"
import type { InterfaceValidator } from "@entrypoint-0.7/types"
import type { StateOverrides } from "@entrypoint-0.7/types"
import type { ApiVersion } from "@entrypoint-0.7/types"
import type { Logger } from "@alto/utils"
import { calcPreVerificationGas } from "@entrypoint-0.7/utils"
import { calcVerificationGasAndCallGasLimit } from "@entrypoint-0.7/utils"
import {
    zeroAddress,
    type Account,
    type Chain,
    type PublicClient,
    type Transport,
    pad,
    toHex,
    slice
} from "viem"
import { simulateHandleOp, simulateValidation } from "../EntryPointSimulations"

const maxUint48 = 2 ** 48 - 1

export class UnsafeValidator implements InterfaceValidator {
    publicClient: PublicClient<Transport, Chain>
    entryPoint: Address
    logger: Logger
    metrics: Metrics
    utilityWallet: Account
    usingTenderly: boolean
    balanceOverrideEnabled: boolean
    disableExpirationCheck: boolean
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
        balanceOverrideEnabled = false,
        disableExpirationCheck = false
    ) {
        this.publicClient = publicClient
        this.entryPoint = entryPoint
        this.logger = logger
        this.metrics = metrics
        this.utilityWallet = utilityWallet
        this.usingTenderly = usingTenderly
        this.balanceOverrideEnabled = balanceOverrideEnabled
        this.disableExpirationCheck = disableExpirationCheck
        this.apiVersion = apiVersion
        this.chainId = publicClient.chain.id
    }

    async getExecutionResult(
        userOperation: UnPackedUserOperation,
        stateOverrides?: StateOverrides
    ): Promise<ExecutionResult> {
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
                error.code ?? ValidationErrors.SimulateValidation,
                error.data
            )
        }

        return error.data
    }

    async getValidationResult(
        userOperation: UnPackedUserOperation,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        const simulateValidationResult = await simulateValidation(
            userOperation,
            this.entryPoint,
            this.publicClient
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
            simulateValidationResult.data as ValidationResultWithAggregation

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

    async validatePreVerificationGas(userOperation: UnPackedUserOperation) {
        const preVerificationGas = await calcPreVerificationGas(
            this.publicClient,
            userOperation,
            this.entryPoint,
            this.chainId,
            this.logger
        )

        if (preVerificationGas > userOperation.preVerificationGas) {
            throw new RpcError(
                `preVerificationGas is not enough, required: ${preVerificationGas}, got: ${userOperation.preVerificationGas}`,
                ValidationErrors.SimulateValidation
            )
        }
    }

    async validateUserOperation(
        userOperation: UnPackedUserOperation,
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

            const prefund = validationResult.returnInfo.prefund

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

            const mul = userOperation.paymaster ? 3n : 1n

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

            this.metrics.userOperationsValidationSuccess.inc()

            return validationResult
        } catch (e) {
            // console.log(e)
            this.metrics.userOperationsValidationFailure.inc()
            throw e
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

    parseValidationData(validationData: bigint): {
        aggregator: string
        validAfter: number
        validUntil: number
    } {
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
}
