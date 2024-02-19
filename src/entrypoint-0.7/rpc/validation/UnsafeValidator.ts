import type { Metrics } from "@alto/utils"
import {
    type Address,
    ExecutionErrors,
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
import type { Account, Chain, PublicClient, Transport } from "viem"
import { simulateHandleOp, simulateValidation } from "../EntryPointSimulations"

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
            userOperation.sender,
            userOperation.callData,
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
                ExecutionErrors.UserOperationReverted
            )
        }

        return {
            ...(simulateValidationResult.data as ValidationResult),
            storageMap: {}
        }
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

            if (validationResult.returnInfo.accountValidationData) {
                throw new RpcError(
                    "User operation validation failed",
                    ValidationErrors.InvalidSignature
                )
            }

            if (validationResult.returnInfo.paymasterValidationData) {
                throw new RpcError(
                    "Paymaster validation failed",
                    ValidationErrors.InvalidSignature
                )
            }

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
}
