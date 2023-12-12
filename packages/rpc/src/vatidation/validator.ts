import {
    Address,
    EntryPointAbi,
    ExecutionResult,
    RpcError,
    StakeInfo,
    UserOperation,
    ValidationErrors,
    ValidationResultWithAggregation,
    entryPointErrorsSchema,
    entryPointExecutionErrorSchema
} from "@alto/types"
import { ValidationResult } from "@alto/types"
import {
    Logger,
    Metrics,
    getAddressFromInitCodeOrPaymasterAndData
} from "@alto/utils"
import {
    PublicClient,
    getContract,
    encodeFunctionData,
    decodeErrorResult,
    Account,
    Transport,
    Chain,
    zeroAddress,
    keccak256,
    decodeAbiParameters,
    Hex
} from "viem"
import { hexDataSchema } from "@alto/types"
import { z } from "zod"
import { fromZodError } from "zod-validation-error"
import {
    BundlerTracerResult,
    ExitInfo,
    bundlerCollectorTracer
} from "./BundlerCollectorTracer"
import { debug_traceCall } from "./tracer"
import { tracerResultParser } from "./TracerResultParser"
import { IReputationManager } from "@alto/mempool"

export interface IValidator {
    getExecutionResult(
        userOperation: UserOperation,
        usingTenderly?: boolean
    ): Promise<ExecutionResult>
    getValidationResult(
        userOperation: UserOperation,
        usingTenderly?: boolean
    ): Promise<ValidationResult>
    validateUserOperation(
        userOperation: UserOperation,
        usingTenderly?: boolean
    ): Promise<ValidationResult>
}

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

const ErrorSig = keccak256(Buffer.from("Error(string)")).slice(0, 10) // 0x08c379a0
const FailedOpSig = keccak256(Buffer.from("FailedOp(uint256,string)")).slice(
    0,
    10
) // 0x220266b6

interface DecodedError {
    message: string
    opIndex?: number
}

/**
 * decode bytes thrown by revert as Error(message) or FailedOp(opIndex,paymaster,message)
 */
export function decodeErrorReason(error: string): DecodedError | null {
    if (error.startsWith(ErrorSig)) {
        const [message] = decodeAbiParameters(
            ["string"],
            `0x${error.substring(10)}`
        ) as [string]
        return { message }
    }
    if (error.startsWith(FailedOpSig)) {
        let [opIndex, message] = decodeAbiParameters(
            ["uint256", "string"],
            `0x${error.substring(10)}`
        ) as [number, string]
        message = `FailedOp: ${message as string}`
        return {
            message,
            opIndex
        }
    }
    return null
}

async function getSimulationResult(
    errorResult: unknown,
    logger: Logger,
    simulationType: "validation" | "execution",
    usingTenderly = false
) {
    const entryPointErrorSchemaParsing = usingTenderly
        ? entryPointErrorsSchema.safeParse(errorResult)
        : entryPointExecutionErrorSchema.safeParse(errorResult)
    if (!entryPointErrorSchemaParsing.success) {
        const err = fromZodError(entryPointErrorSchemaParsing.error)
        logger.error(
            { error: err.message },
            "unexpected error during valiation"
        )
        logger.error(JSON.stringify(errorResult))
        err.message = `User Operation simulation returned unexpected invalid response: ${err.message}`
        throw err
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

    constructor(
        publicClient: PublicClient<Transport, Chain>,
        entryPoint: Address,
        logger: Logger,
        metrics: Metrics,
        utilityWallet: Account,
        usingTenderly = false
    ) {
        this.publicClient = publicClient
        this.entryPoint = entryPoint
        this.logger = logger
        this.metrics = metrics
        this.utilityWallet = utilityWallet
        this.usingTenderly = usingTenderly
    }

    async getExecutionResult(
        userOperation: UserOperation
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

            // @ts-ignore
            return getSimulationResult(
                errorResult,
                this.logger,
                "execution",
                this.usingTenderly
            )
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

        // @ts-ignore
        return getSimulationResult(
            errorResult,
            this.logger,
            "execution",
            this.usingTenderly
        )
    }

    async getValidationResult(
        userOperation: UserOperation
    ): Promise<ValidationResult | ValidationResultWithAggregation> {
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

            // @ts-ignore
            return getSimulationResult(
                errorResult,
                this.logger,
                "validation",
                this.usingTenderly
            )
        }

        const errorResult = await entryPointContract.simulate
            .simulateValidation([userOperation])
            .catch((e) => {
                if (e instanceof Error) {
                    return e
                }
                throw e
            })

        // @ts-ignore
        return getSimulationResult(
            errorResult,
            this.logger,
            "validation",
            this.usingTenderly
        )
    }

    async validateUserOperation(
        userOperation: UserOperation
    ): Promise<ValidationResult | ValidationResultWithAggregation> {
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
    reputationManager: IReputationManager

    constructor(
        publicClient: PublicClient<Transport, Chain>,
        entryPoint: Address,
        logger: Logger,
        metrics: Metrics,
        utilityWallet: Account,
        reputationManager: IReputationManager,
        usingTenderly = false
    ) {
        super(
            publicClient,
            entryPoint,
            logger,
            metrics,
            utilityWallet,
            usingTenderly
        )
        this.reputationManager = reputationManager
    }

    async validateUserOperation(
        userOperation: UserOperation
    ): Promise<ValidationResult | ValidationResultWithAggregation> {
        try {
            const validationResult =
                await this.getValidationResult(userOperation)

            await this.reputationManager.checkReputation(
                userOperation,
                validationResult
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

    async getValidationResult(
        userOperation: UserOperation
    ): Promise<ValidationResult | ValidationResultWithAggregation> {
        if (this.usingTenderly) {
            return super.getValidationResult(userOperation)
        }

        const [res, tracerResult] =
            await this.getValidationResultWithTracer(userOperation)

        // const [contractAddresses, storageMap] =
        tracerResultParser(
            userOperation,
            tracerResult,
            res,
            this.entryPoint.toLowerCase() as Address
        )

        // const [contractAddresses, storageMap] = tracerResultParser(userOp, tracerResult, res, this.entryPoint)

        if ((res as any) === "0x") {
            throw new Error(
                "simulateValidation reverted with no revert string!"
            )
        }
        return res
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
            // not a known error of EntryPoint (probably, only Error(string), since FailedOp is handled above)
            const err = decodeErrorReason(data)
            throw new RpcError(err != null ? err.message : data, 111)
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
            aggregatorInfo // may be missing (exists only SimulationResultWithAggregator
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
