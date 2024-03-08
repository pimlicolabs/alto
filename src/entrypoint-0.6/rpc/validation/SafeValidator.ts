import type { GasPriceManager, Metrics } from "@alto/utils"
import type { SenderManager } from "@alto/executor"
import {
    type Address,
    CodeHashGetterAbi,
    CodeHashGetterBytecode,
    EntryPointAbi,
    type ReferencedCodeHashes,
    RpcError,
    type StakeInfo,
    type StorageMap,
    type UserOperation,
    ValidationErrors,
    type ValidationResultWithAggregation
} from "@entrypoint-0.6/types"
import type { ValidationResult } from "@entrypoint-0.6/types"
import type { InterfaceValidator } from "@entrypoint-0.6/types"
import type { ApiVersion } from "@entrypoint-0.6/types"
import type { Logger } from "@alto/utils"
import {
    calcVerificationGasAndCallGasLimit,
    getAddressFromInitCodeOrPaymasterAndData
} from "@entrypoint-0.6/utils"
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
    zeroAddress
} from "viem"
import {
    type BundlerTracerResult,
    type ExitInfo,
    bundlerCollectorTracer
} from "./BundlerCollectorTracer"
import { tracerResultParser } from "./TracerResultParser"
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
        entryPoint: Address,
        logger: Logger,
        metrics: Metrics,
        utilityWallet: Account,
        apiVersion: ApiVersion,
        gasPriceManager: GasPriceManager,
        usingTenderly = false,
        balanceOverrideEnabled = false
    ) {
        super(
            publicClient,
            entryPoint,
            logger,
            metrics,
            utilityWallet,
            apiVersion,
            gasPriceManager,
            usingTenderly,
            balanceOverrideEnabled
        )
        this.senderManager = senderManager
    }

    async validateUserOperation(
        userOperation: UserOperation,
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

            if (this.apiVersion !== "v1") {
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

                const mul = userOperation.paymasterAndData === "0x" ? 3n : 1n

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

    async getValidationResult(
        userOperation: UserOperation,
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
        return {
            ...res,
            referencedContracts: codeHashes,
            storageMap
        }
    }

    async getValidationResultWithTracer(
        userOperation: UserOperation
    ): Promise<[ValidationResult, BundlerTracerResult]> {
        const tracerResult = await debug_traceCall(
            this.publicClient,
            {
                from: zeroAddress,
                to: this.entryPoint,
                data: encodeFunctionData({
                    abi: EntryPointAbi,
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
                abi: EntryPointAbi,
                data
            })

            const errFullName = `${errorName}(${errorArgs.toString()})`
            const errorResult = this.parseErrorResult(userOperation, {
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

    parseErrorResult(
        userOp: UserOperation,
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
                addr: userOp.sender
            },
            factoryInfo: fillEntity(userOp.initCode, factoryInfo),
            paymasterInfo: fillEntity(userOp.paymasterAndData, paymasterInfo),
            aggregatorInfo: fillEntityAggregator(
                aggregatorInfo?.actualAggregator,
                aggregatorInfo?.stakeInfo
            )
        }
    }
}
