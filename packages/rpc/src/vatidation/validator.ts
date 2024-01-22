import {
    type Address,
    EntryPointAbi,
    type ExecutionResult,
    RpcError,
    type StakeInfo,
    type StorageMap,
    type UserOperation,
    ValidationErrors,
    type ValidationResultWithAggregation,
    entryPointErrorsSchema,
    type ReferencedCodeHashes,
    entryPointExecutionErrorSchema,
    CodeHashGetterBytecode,
    CodeHashGetterAbi,
    ExecutionErrors
} from "@alto/types"
import type { ValidationResult } from "@alto/types"
import {
    type Logger,
    type Metrics,
    getAddressFromInitCodeOrPaymasterAndData
} from "@alto/utils"
import {
    type PublicClient,
    getContract,
    encodeFunctionData,
    decodeErrorResult,
    type Account,
    type Transport,
    type Chain,
    zeroAddress,
    type Hex,
    encodeDeployData,
    type ExecutionRevertedError,
    ContractFunctionExecutionError,
    BaseError
} from "viem"
import { hexDataSchema } from "@alto/types"
import { z } from "zod"
import { fromZodError } from "zod-validation-error"
import {
    type BundlerTracerResult,
    type ExitInfo,
    bundlerCollectorTracer
} from "./BundlerCollectorTracer"
import { debug_traceCall } from "./tracer"
import { tracerResultParser } from "./TracerResultParser"
import type { IValidator } from "@alto/types"
import type { SenderManager } from "@alto/executor"
import * as sentry from "@sentry/node"
import { simulateHandleOp } from "../gasEstimation"
import type { StateOverrides } from "@alto/types"

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
                    `UserOperation reverted during simulation with reason: ${(revertError?.cause as any)?.reason
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

    constructor(
        publicClient: PublicClient<Transport, Chain>,
        entryPoint: Address,
        logger: Logger,
        metrics: Metrics,
        utilityWallet: Account,
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

            this.metrics.userOperationsValidationSuccess.inc()

            return validationResult
        } catch (e) {
            // console.log(e)
            this.metrics.userOperationsValidationFailure.inc()
            throw e
        }
    }
}

export class SafeValidator extends UnsafeValidator implements IValidator {
    private senderManager: SenderManager

    constructor(
        publicClient: PublicClient<Transport, Chain>,
        senderManager: SenderManager,
        entryPoint: Address,
        logger: Logger,
        metrics: Metrics,
        utilityWallet: Account,
        usingTenderly = false,
        balanceOverrideEnabled = false
    ) {
        super(
            publicClient,
            entryPoint,
            logger,
            metrics,
            utilityWallet,
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

            if (
                validationResult.returnInfo.validUntil <
                Date.now() / 1000 + 30
            ) {
                throw new RpcError(
                    "expires too soon",
                    ValidationErrors.ExpiresShortly
                )
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
        codeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            referencedContracts?: ReferencedCodeHashes
            storageMap: StorageMap
        }
    > {
        if (this.usingTenderly) {
            return super.getValidationResult(userOperation)
        }

        if (codeHashes && codeHashes.addresses.length > 0) {
            const { hash } = await this.getCodeHashes(codeHashes.addresses)
            if (hash !== codeHashes.hash) {
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

        if (!codeHashes) {
            codeHashes = await this.getCodeHashes(contractAddresses)
        }

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
