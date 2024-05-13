import type { SenderManager } from "@alto/executor"
import type {
    ChainType,
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
    CodeHashGetterAbi,
    CodeHashGetterBytecode,
    EntryPointV06Abi,
    EntryPointV07Abi,
    EntryPointV07SimulationsAbi,
    PimlicoEntryPointSimulationsAbi,
    PimlicoEntryPointSimulationsBytecode,
    RpcError,
    ValidationErrors,
    type Address,
    type ReferencedCodeHashes,
    type StakeInfo,
    type StorageMap,
    type UserOperation,
    type ValidationResultWithAggregation
} from "@alto/types"
import type { GasPriceManager, Logger, Metrics } from "@alto/utils"
import {
    calcVerificationGasAndCallGasLimit,
    getAddressFromInitCodeOrPaymasterAndData,
    isVersion06,
    isVersion07,
    toPackedUserOperation
} from "@alto/utils"
import {
    decodeAbiParameters,
    decodeErrorResult,
    encodeDeployData,
    encodeFunctionData,
    zeroAddress,
    type Chain,
    type ExecutionRevertedError,
    type Hex,
    type PublicClient,
    type Transport
} from "viem"
import { parseFailedOpWithRevert } from "../EntryPointSimulationsV07"
import {
    bundlerCollectorTracer,
    type BundlerTracerResult,
    type ExitInfo
} from "./BundlerCollectorTracerV06"
import { tracerResultParserV06 } from "./TracerResultParserV06"
import { tracerResultParserV07 } from "./TracerResultParserV07"
import { UnsafeValidator } from "./UnsafeValidator"
import { debug_traceCall } from "./tracer"

export class SafeValidator
    extends UnsafeValidator
    implements InterfaceValidator
{
    private senderManager: SenderManager

    constructor(
        publicClient: PublicClient<Transport, Chain>,
        senderManager: SenderManager,
        logger: Logger,
        metrics: Metrics,
        gasPriceManager: GasPriceManager,
        chainType: ChainType,
        entryPointSimulationsAddress?: Address,
        usingTenderly = false,
        balanceOverrideEnabled = false
    ) {
        super(
            publicClient,
            logger,
            metrics,
            gasPriceManager,
            chainType,
            entryPointSimulationsAddress,
            usingTenderly,
            balanceOverrideEnabled
        )
        this.senderManager = senderManager
    }

    async validateUserOperation(
        shouldCheckPrefund: boolean,
        userOperation: UserOperation,
        queuedUserOperations: UserOperation[],
        entryPoint: Address,
        referencedContracts?: ReferencedCodeHashes
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
                entryPoint,
                referencedContracts
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
            await this.publicClient.call({
                account: wallet,
                data: deployData
            })
        } catch (e) {
            const error = e as ExecutionRevertedError
            // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
            hash = (error.walk() as any).data
        }

        this.senderManager.pushWallet(wallet)

        return {
            hash,
            addresses
        }
    }

    async getValidationResultV07(
        userOperation: UserOperationV07,
        queuedUserOperations: UserOperationV07[],
        entryPoint: Address,
        preCodeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResultV07 | ValidationResultWithAggregationV07) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        if (this.usingTenderly) {
            return super.getValidationResultV07(
                userOperation,
                queuedUserOperations,
                entryPoint
            )
        }

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

        const now = Math.floor(Date.now() / 1000)

        if (
            res.returnInfo.validAfter === undefined ||
            res.returnInfo.validAfter > now - 5
        ) {
            throw new RpcError(
                `User operation is not valid yet, validAfter=${res.returnInfo.validAfter}, now=${now}`,
                ValidationErrors.ExpiresShortly
            )
        }

        if (
            res.returnInfo.validUntil === undefined ||
            res.returnInfo.validUntil < now + 30
        ) {
            throw new RpcError(
                `UserOperation expires too soon, validUntil=${res.returnInfo.validUntil}, now=${now}`,
                ValidationErrors.ExpiresShortly
            )
        }

        return {
            ...res,
            referencedContracts: codeHashes,
            storageMap
        }
    }

    async getValidationResultV06(
        userOperation: UserOperationV06,
        entryPoint: Address,
        preCodeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResultV06 | ValidationResultWithAggregationV06) & {
            referencedContracts?: ReferencedCodeHashes
            storageMap: StorageMap
        }
    > {
        if (this.usingTenderly) {
            return super.getValidationResultV06(userOperation, entryPoint)
        }

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
        const tracerResult = await debug_traceCall(
            this.publicClient,
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
                tracer: bundlerCollectorTracer
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
        entryPoint: Address
    ): Promise<[ValidationResultV07, BundlerTracerResult]> {
        const packedUserOperation = toPackedUserOperation(userOperation)

        const entryPointSimulationsCallData = encodeFunctionData({
            abi: EntryPointV07SimulationsAbi,
            functionName: "simulateValidation",
            args: [packedUserOperation]
        })

        const callData = encodeDeployData({
            abi: PimlicoEntryPointSimulationsAbi,
            bytecode: PimlicoEntryPointSimulationsBytecode,
            args: [entryPoint, entryPointSimulationsCallData]
        })

        const tracerResult = await debug_traceCall(
            this.publicClient,
            {
                from: zeroAddress,
                data: callData
            },
            {
                tracer: bundlerCollectorTracer
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
                abi: EntryPointV07Abi,
                data
            })

            const errorResult = this.parseErrorResultV07(userOperation, {
                errorName,
                errorArgs
            })

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

    parseErrorResultV07(
        userOperation: UserOperationV07,
        // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        errorResult: { errorName: string; errorArgs: any }
    ): ValidationResult | ValidationResultWithAggregation {
        let decodedResult: any

        try {
            decodeErrorResult({
                abi: EntryPointV07SimulationsAbi,
                data: errorResult.errorArgs[1] as Hex
            })

            const result = decodeErrorResult({
                abi: EntryPointV07SimulationsAbi,
                data: errorResult.errorArgs[1] as Hex
            })

            if (result.errorName === "FailedOp") {
                if ((result.args?.[1] as string).includes("AA24")) {
                    throw new RpcError(
                        "Invalid UserOp signature",
                        ValidationErrors.InvalidSignature
                    )
                }

                if ((result.args?.[1] as string).includes("AA34")) {
                    throw new RpcError(
                        "Invalid UserOp paymasterData",
                        ValidationErrors.InvalidSignature
                    )
                }

                throw new RpcError(
                    `ValidationResult error: ${result.args?.[1]}`,
                    ValidationErrors.SimulateValidation
                )
            }

            if (result.errorName === "FailedOpWithRevert") {
                const data = result.args?.[2] as Hex
                const error = parseFailedOpWithRevert(data)

                throw new RpcError(
                    `ValidationResult error: ${result.args?.[1]} with revert error as: Panic(${error})`,
                    ValidationErrors.SimulateValidation
                )
            }

            throw new RpcError(
                `ValidationResult error: ${result.errorName}`,
                ValidationErrors.SimulateValidation
            )
        } catch (e) {
            if (e instanceof RpcError) {
                throw e
            }
            decodedResult = decodeAbiParameters(
                [
                    {
                        components: [
                            {
                                components: [
                                    {
                                        internalType: "uint256",
                                        name: "preOpGas",
                                        type: "uint256"
                                    },
                                    {
                                        internalType: "uint256",
                                        name: "prefund",
                                        type: "uint256"
                                    },
                                    {
                                        internalType: "uint256",
                                        name: "accountValidationData",
                                        type: "uint256"
                                    },
                                    {
                                        internalType: "uint256",
                                        name: "paymasterValidationData",
                                        type: "uint256"
                                    },
                                    {
                                        internalType: "bytes",
                                        name: "paymasterContext",
                                        type: "bytes"
                                    }
                                ],
                                internalType: "struct IEntryPoint.ReturnInfo",
                                name: "returnInfo",
                                type: "tuple"
                            },
                            {
                                components: [
                                    {
                                        internalType: "uint256",
                                        name: "stake",
                                        type: "uint256"
                                    },
                                    {
                                        internalType: "uint256",
                                        name: "unstakeDelaySec",
                                        type: "uint256"
                                    }
                                ],
                                internalType: "struct IStakeManager.StakeInfo",
                                name: "senderInfo",
                                type: "tuple"
                            },
                            {
                                components: [
                                    {
                                        internalType: "uint256",
                                        name: "stake",
                                        type: "uint256"
                                    },
                                    {
                                        internalType: "uint256",
                                        name: "unstakeDelaySec",
                                        type: "uint256"
                                    }
                                ],
                                internalType: "struct IStakeManager.StakeInfo",
                                name: "factoryInfo",
                                type: "tuple"
                            },
                            {
                                components: [
                                    {
                                        internalType: "uint256",
                                        name: "stake",
                                        type: "uint256"
                                    },
                                    {
                                        internalType: "uint256",
                                        name: "unstakeDelaySec",
                                        type: "uint256"
                                    }
                                ],
                                internalType: "struct IStakeManager.StakeInfo",
                                name: "paymasterInfo",
                                type: "tuple"
                            },
                            {
                                components: [
                                    {
                                        internalType: "address",
                                        name: "aggregator",
                                        type: "address"
                                    },
                                    {
                                        components: [
                                            {
                                                internalType: "uint256",
                                                name: "stake",
                                                type: "uint256"
                                            },
                                            {
                                                internalType: "uint256",
                                                name: "unstakeDelaySec",
                                                type: "uint256"
                                            }
                                        ],
                                        internalType:
                                            "struct IStakeManager.StakeInfo",
                                        name: "stakeInfo",
                                        type: "tuple"
                                    }
                                ],
                                internalType:
                                    "struct IEntryPoint.AggregatorStakeInfo",
                                name: "aggregatorInfo",
                                type: "tuple"
                            }
                        ],
                        internalType:
                            "struct IEntryPointSimulations.ValidationResult",
                        name: "",
                        type: "tuple"
                    }
                ],
                errorResult.errorArgs[1] as Hex
            )[0]
        }

        const mergedValidation = this.mergeValidationDataValues(
            decodedResult.returnInfo.accountValidationData,
            decodedResult.returnInfo.paymasterValidationData
        )

        return {
            returnInfo: {
                ...decodedResult.returnInfo,
                accountSigFailed: mergedValidation.accountSigFailed,
                paymasterSigFailed: mergedValidation.paymasterSigFailed,
                validUntil: mergedValidation.validUntil,
                validAfter: mergedValidation.validAfter
            },
            senderInfo: {
                ...decodedResult.senderInfo,
                addr: userOperation.sender
            },
            factoryInfo:
                userOperation.factory && decodedResult.factoryInfo
                    ? {
                          ...decodedResult.factoryInfo,
                          addr: userOperation.factory
                      }
                    : undefined,
            paymasterInfo:
                userOperation.paymaster && decodedResult.paymasterInfo
                    ? {
                          ...decodedResult.paymasterInfo,
                          addr: userOperation.paymaster
                      }
                    : undefined,
            aggregatorInfo: decodedResult.aggregatorInfo
        }
    }
}
