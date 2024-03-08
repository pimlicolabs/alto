import type { GasPriceManager, Metrics } from "@alto/utils"
import type { SenderManager } from "@alto/executor"
import {
    type Address,
    CodeHashGetterAbi,
    CodeHashGetterBytecode,
    EntryPointAbi,
    type ReferencedCodeHashes,
    RpcError,
    type StorageMap,
    ValidationErrors,
    type ValidationResultWithAggregation,
    EntryPointSimulationsAbi,
    PimlicoEntryPointSimulationsAbi,
    PimlicoEntryPointSimulationsBytecode
} from "@entrypoint-0.7/types"
import type {
    UnPackedUserOperation,
    ValidationResult
} from "@entrypoint-0.7/types"
import type { InterfaceValidator } from "@entrypoint-0.7/types"
import type { ApiVersion } from "@entrypoint-0.7/types"
import type { Logger } from "@alto/utils"
import {
    calcVerificationGasAndCallGasLimit,
    toPackedUserOperation
} from "@entrypoint-0.7/utils"
import {
    type Account,
    type Chain,
    type ExecutionRevertedError,
    type Hex,
    type PublicClient,
    type Transport,
    decodeErrorResult,
    encodeDeployData,
    encodeFunctionData,
    zeroAddress,
    decodeAbiParameters
} from "viem"
import {
    type BundlerTracerResult,
    type ExitInfo,
    bundlerCollectorTracer
} from "./BundlerCollectorTracer"
import { tracerResultParser } from "./TracerResultParser"
import { UnsafeValidator } from "./UnsafeValidator"
import { debug_traceCall } from "./tracer"
import { parseFailedOpWithRevert } from "../EntryPointSimulations"

export class SafeValidator
    extends UnsafeValidator
    implements InterfaceValidator
{
    private senderManager: SenderManager

    constructor(
        publicClient: PublicClient<Transport, Chain>,
        senderManager: SenderManager,
        entryPoint: Address,
        logger: Logger,
        metrics: Metrics,
        gasPriceManager: GasPriceManager,
        utilityWallet: Account,
        apiVersion: ApiVersion,
        entryPointSimulationsAddress: Address,
        usingTenderly = false,
        balanceOverrideEnabled = false
    ) {
        super(
            publicClient,
            entryPoint,
            logger,
            metrics,
            gasPriceManager,
            utilityWallet,
            apiVersion,
            entryPointSimulationsAddress,
            usingTenderly,
            balanceOverrideEnabled
        )
        this.senderManager = senderManager
    }

    async validateUserOperation(
        userOperation: UnPackedUserOperation,
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
                referencedContracts
            )

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

            const mul = userOperation.paymaster === "0x" ? 3n : 1n

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

    async getValidationResult(
        userOperation: UnPackedUserOperation,
        preCodeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            referencedContracts?: ReferencedCodeHashes
            storageMap: StorageMap
        }
    > {
        if (this.usingTenderly) {
            return super.getValidationResult(userOperation)
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

        const [res, tracerResult] =
            await this.getValidationResultWithTracer(userOperation)

        const [contractAddresses, storageMap] = tracerResultParser(
            userOperation,
            tracerResult,
            res,
            this.entryPoint.toLowerCase() as Address
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

    async getValidationResultWithTracer(
        userOperation: UnPackedUserOperation
    ): Promise<[ValidationResult, BundlerTracerResult]> {
        const packedUserOperation = toPackedUserOperation(userOperation)

        const entryPointSimulationsCallData = encodeFunctionData({
            abi: EntryPointSimulationsAbi,
            functionName: "simulateValidation",
            args: [packedUserOperation]
        })

        const callData = encodeDeployData({
            abi: PimlicoEntryPointSimulationsAbi,
            bytecode: PimlicoEntryPointSimulationsBytecode,
            args: [this.entryPoint, entryPointSimulationsCallData]
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
                abi: EntryPointAbi,
                data
            })

            const errorResult = this.parseErrorResult(userOperation, {
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

    parseErrorResult(
        userOp: UnPackedUserOperation,
        // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        errorResult: { errorName: string; errorArgs: any }
    ): ValidationResult | ValidationResultWithAggregation {
        let decodedResult: any

        try {
            decodeErrorResult({
                abi: EntryPointSimulationsAbi,
                data: errorResult.errorArgs[1] as Hex
            })

            const result = decodeErrorResult({
                abi: EntryPointSimulationsAbi,
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
                addr: userOp.sender
            },
            factoryInfo:
                userOp.factory && decodedResult.factoryInfo
                    ? {
                          ...decodedResult.factoryInfo,
                          addr: userOp.factory
                      }
                    : undefined,
            paymasterInfo:
                userOp.paymaster && decodedResult.paymasterInfo
                    ? {
                          ...decodedResult.paymasterInfo,
                          addr: userOp.paymaster
                      }
                    : undefined,
            aggregatorInfo: decodedResult.aggregatorInfo
        }
    }
}
