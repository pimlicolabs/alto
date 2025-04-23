import type { SenderManager } from "@alto/executor"
import type { GasPriceManager } from "@alto/handlers"
import type {
    InterfaceValidator,
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
    CodeHashGetterAbi,
    CodeHashGetterBytecode,
    EntryPointV06Abi,
    EntryPointV07SimulationsAbi,
    PimlicoEntryPointSimulationsAbi,
    type ReferencedCodeHashes,
    RpcError,
    type StakeInfo,
    type StorageMap,
    type UserOperation,
    ValidationErrors,
    type ValidationResultWithAggregation
} from "@alto/types"
import type { Metrics } from "@alto/utils"
import {
    getAuthorizationStateOverrides, getAddressFromInitCodeOrPaymasterAndData, toPackedUserOperation,
    isVersion08
} from "@alto/utils"
import {
    type ExecutionRevertedError,
    type Hex,
    decodeErrorResult,
    encodeDeployData,
    encodeFunctionData,
    zeroAddress
} from "viem"
import { getSimulateValidationResult } from "../estimation/gasEstimationsV07"
import {
    type BundlerTracerResult,
    type ExitInfo,
    bundlerCollectorTracer
} from "./BundlerCollectorTracerV07"
import { tracerResultParserV06 } from "./TracerResultParserV06"
import { tracerResultParserV07 } from "./TracerResultParserV07"
import { UnsafeValidator } from "./UnsafeValidator"
import { debug_traceCall } from "./tracer"
import type { AltoConfig } from "../../createConfig"

export class SafeValidator
    extends UnsafeValidator
    implements InterfaceValidator
{
    private senderManager: SenderManager

    constructor({
        config,
        senderManager,
        metrics,
        gasPriceManager
    }: {
        config: AltoConfig
        senderManager: SenderManager
        metrics: Metrics
        gasPriceManager: GasPriceManager
    }) {
        super({
            config,
            metrics,
            gasPriceManager
        })
        this.senderManager = senderManager
    }

    async validateUserOperation({
        userOperation,
        queuedUserOperations,
        entryPoint,
        referencedContracts
    }: {
        userOperation: UserOperation
        queuedUserOperations: UserOperation[]
        entryPoint: Address
        referencedContracts?: ReferencedCodeHashes
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
                entryPoint,
                codeHashes: referencedContracts
            })

            this.metrics.userOperationsValidationSuccess.inc()

            return validationResult
        } catch (e) {
            this.metrics.userOperationsValidationFailure.inc()
            throw e
        }
    }

    async getCodeHashes(addresses: string[]): Promise<ReferencedCodeHashes> {
        const deployData = encodeDeployData({
            abi: CodeHashGetterAbi,
            bytecode: CodeHashGetterBytecode,
            args: [addresses]
        })

        const wallet = await this.senderManager.getWallet()

        let hash = ""

        try {
            await this.config.publicClient.call({
                account: wallet,
                data: deployData
            })
        } catch (e) {
            const error = e as ExecutionRevertedError
            // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
            hash = (error.walk() as any).data
        }

        this.senderManager.markWalletProcessed(wallet)

        return {
            hash,
            addresses
        }
    }

    async getValidationResultV07({
        userOperation,
        queuedUserOperations,
        entryPoint,
        preCodeHashes
    }: {
        userOperation: UserOperationV07
        queuedUserOperations: UserOperationV07[]
        entryPoint: Address
        preCodeHashes?: ReferencedCodeHashes
    }): Promise<
        (ValidationResultV07 | ValidationResultWithAggregationV07) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        if (preCodeHashes && preCodeHashes.addresses.length > 0) {
            const { hash } = await this.getCodeHashes(preCodeHashes.addresses)
            if (hash !== preCodeHashes.hash) {
                throw new RpcError(
                    "code hashes mismatch",
                    ValidationErrors.OpcodeValidation
                )
            }
        }

        const [res, tracerResult] = await this.getValidationResultWithTracerV07(
            userOperation,
            queuedUserOperations,
            entryPoint
        )

        const [contractAddresses, storageMap] = tracerResultParserV07(
            userOperation,
            tracerResult,
            res,
            entryPoint.toLowerCase() as Address
        )

        const codeHashes: ReferencedCodeHashes =
            preCodeHashes || (await this.getCodeHashes(contractAddresses))

        // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        if ((res as any) === "0x") {
            throw new Error(
                "simulateValidation reverted with no revert string!"
            )
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

        return {
            ...res,
            referencedContracts: codeHashes,
            storageMap
        }
    }

    async getValidationResultV06({
        userOperation,
        entryPoint,
        preCodeHashes
    }: {
        userOperation: UserOperationV06
        entryPoint: Address
        preCodeHashes?: ReferencedCodeHashes
    }): Promise<
        (ValidationResultV06 | ValidationResultWithAggregationV06) & {
            referencedContracts?: ReferencedCodeHashes
            storageMap: StorageMap
        }
    > {
        if (preCodeHashes && preCodeHashes.addresses.length > 0) {
            const { hash } = await this.getCodeHashes(preCodeHashes.addresses)
            if (hash !== preCodeHashes.hash) {
                throw new RpcError(
                    "code hashes mismatch",
                    ValidationErrors.OpcodeValidation
                )
            }
        }

        const [res, tracerResult] = await this.getValidationResultWithTracerV06(
            userOperation,
            entryPoint
        )

        const [contractAddresses, storageMap] = tracerResultParserV06(
            userOperation,
            tracerResult,
            res,
            entryPoint.toLowerCase() as Address
        )

        const codeHashes: ReferencedCodeHashes =
            preCodeHashes || (await this.getCodeHashes(contractAddresses))

        // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        if ((res as any) === "0x") {
            throw new Error(
                "simulateValidation reverted with no revert string!"
            )
        }
        const validationResult = {
            ...res,
            referencedContracts: codeHashes,
            storageMap
        }

        if (validationResult.returnInfo.sigFailed) {
            throw new RpcError(
                "Invalid UserOp signature or paymaster signature",
                ValidationErrors.InvalidSignature
            )
        }

        const now = Date.now() / 1000

        this.logger.debug({
            validAfter: validationResult.returnInfo.validAfter,
            validUntil: validationResult.returnInfo.validUntil,
            now: now
        })

        if (validationResult.returnInfo.validAfter > now - 5) {
            throw new RpcError(
                "User operation is not valid yet",
                ValidationErrors.ExpiresShortly
            )
        }

        if (validationResult.returnInfo.validUntil < now + 30) {
            throw new RpcError(
                "expires too soon",
                ValidationErrors.ExpiresShortly
            )
        }

        return validationResult
    }

    async getValidationResultWithTracerV06(
        userOperation: UserOperationV06,
        entryPoint: Address
    ): Promise<[ValidationResultV06, BundlerTracerResult]> {
        const stateOverrides = getAuthorizationStateOverrides({
            userOperations: [userOperation]
        })

        const tracerResult = await debug_traceCall(
            this.config.publicClient,
            {
                from: zeroAddress,
                to: entryPoint,
                data: encodeFunctionData({
                    abi: EntryPointV06Abi,
                    functionName: "simulateValidation",
                    args: [userOperation]
                })
            },
            {
                tracer: bundlerCollectorTracer,
                stateOverrides
            }
        )

        const lastResult = tracerResult.calls.slice(-1)[0]
        if (lastResult.type !== "REVERT") {
            throw new Error("Invalid response. simulateCall must revert")
        }

        const data = (lastResult as ExitInfo).data
        if (data === "0x") {
            // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
            return [data as any, tracerResult]
        }

        try {
            const { errorName, args: errorArgs } = decodeErrorResult({
                abi: EntryPointV06Abi,
                data
            })

            const errFullName = `${errorName}(${errorArgs.toString()})`
            const errorResult = this.parseErrorResultV06(userOperation, {
                errorName,
                errorArgs
            })
            if (!errorName.includes("Result")) {
                // a real error, not a result.
                throw new Error(errFullName)
            }
            // @ts-ignore
            return [errorResult, tracerResult]
            // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        } catch (e: any) {
            // if already parsed, throw as is
            if (e.code != null) {
                throw e
            }
            throw new RpcError(data)
        }
    }

    parseErrorResultV06(
        userOperation: UserOperationV06,
        // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        errorResult: { errorName: string; errorArgs: any }
    ): ValidationResult | ValidationResultWithAggregation {
        if (!errorResult?.errorName?.startsWith("ValidationResult")) {
            // parse it as FailedOp
            // if its FailedOp, then we have the paymaster param... otherwise its an Error(string)
            let paymaster = errorResult.errorArgs.paymaster
            if (paymaster === zeroAddress) {
                paymaster = undefined
            }

            // eslint-disable-next-line
            const msg: string =
                errorResult.errorArgs[1] ?? errorResult.toString()

            if (paymaster == null) {
                throw new RpcError(
                    `account validation failed: ${msg}`,
                    ValidationErrors.SimulateValidation
                )
            }
            throw new RpcError(
                `paymaster validation failed: ${msg}`,
                ValidationErrors.SimulatePaymasterValidation,
                {
                    paymaster
                }
            )
        }

        const [
            returnInfo,
            senderInfo,
            factoryInfo,
            paymasterInfo,
            aggregatorInfo // may be missing (exists only SimulationResultWithAggregator)
        ] = errorResult.errorArgs

        // extract address from "data" (first 20 bytes)
        // add it as "addr" member to the "stakeinfo" struct
        // if no address, then return "undefined" instead of struct.
        function fillEntity(data: Hex, info: StakeInfo): StakeInfo | undefined {
            const addr = getAddressFromInitCodeOrPaymasterAndData(data)
            return addr == null
                ? undefined
                : {
                      ...info,
                      addr
                  }
        }

        function fillEntityAggregator(
            data: Hex,
            info: StakeInfo
        ): { aggregator: Address; stakeInfo: StakeInfo } | undefined {
            const addr = getAddressFromInitCodeOrPaymasterAndData(data)
            return addr == null
                ? undefined
                : {
                      aggregator: data,
                      stakeInfo: {
                          ...info,
                          addr
                      }
                  }
        }

        return {
            returnInfo,
            senderInfo: {
                ...senderInfo,
                addr: userOperation.sender
            },
            factoryInfo: fillEntity(userOperation.initCode, factoryInfo),
            paymasterInfo: fillEntity(
                userOperation.paymasterAndData,
                paymasterInfo
            ),
            aggregatorInfo: fillEntityAggregator(
                aggregatorInfo?.actualAggregator,
                aggregatorInfo?.stakeInfo
            )
        }
    }

    async getValidationResultWithTracerV07(
        userOperation: UserOperationV07,
        queuedUserOperations: UserOperationV07[],
        entryPoint: Address
    ): Promise<[ValidationResultV07, BundlerTracerResult]> {
        const packedUserOperation = toPackedUserOperation(userOperation)
        const packedQueuedUserOperations = queuedUserOperations.map((uop) =>
            toPackedUserOperation(uop)
        )

        const entryPointSimulationsCallData = encodeFunctionData({
            abi: EntryPointV07SimulationsAbi,
            functionName: "simulateValidationLast",
            args: [[...packedQueuedUserOperations, packedUserOperation]]
        })

        const callData = encodeFunctionData({
            abi: PimlicoEntryPointSimulationsAbi,
            functionName: "simulateEntryPoint",
            args: [entryPoint, [entryPointSimulationsCallData]]
        })

        const isV8 = isVersion08(userOperation, entryPoint)

        const entryPointSimulationsAddress = isV8
            ? this.config.entrypointSimulationContractV8
            : this.config.entrypointSimulationContractV7

        const stateOverrides = getAuthorizationStateOverrides({
            userOperations: [userOperation]
        })

        const tracerResult = await debug_traceCall(
            this.config.publicClient,
            {
                from: zeroAddress,
                to: entryPointSimulationsAddress,
                data: callData
            },
            {
                tracer: bundlerCollectorTracer,
                stateOverrides
            }
        )

        this.logger.info(
            `tracerResult: ${JSON.stringify(tracerResult, (_k, v) =>
                typeof v === "bigint" ? v.toString() : v
            )}`
        )

        const lastResult = tracerResult.calls.slice(-1)[0]
        if (lastResult.type !== "REVERT") {
            throw new Error("Invalid response. simulateCall must revert")
        }
        const resultData = lastResult.data as Hex

        const simulateValidationResult = getSimulateValidationResult(resultData)

        if (simulateValidationResult.status === "failed") {
            let errorCode = ValidationErrors.SimulateValidation
            const errorMessage = simulateValidationResult.data as string

            if (errorMessage.includes("AA24")) {
                errorCode = ValidationErrors.InvalidSignature
            }

            if (errorMessage.includes("AA31")) {
                errorCode = ValidationErrors.PaymasterDepositTooLow
            }

            throw new RpcError(errorMessage, errorCode)
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

        return [res, tracerResult]
    }
}
