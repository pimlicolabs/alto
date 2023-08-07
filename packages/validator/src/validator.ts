import { Address, EntryPointAbi, entryPointErrorsSchema, entryPointExecutionErrorSchema, ExecutionResult, hexDataSchema, RpcError, StakeInfo, UserOperation, ValidationErrors, ValidationResult } from "@alto/types"
import { Logger } from "@alto/utils"
import { decodeErrorResult, encodeFunctionData, getAddress, getContract, PublicClient, zeroAddress } from "viem"
import { z } from "zod"
import { fromZodError } from "zod-validation-error"
import { BundlerCollectorReturn, bundlerCollectorTracer, ExitInfo } from "./BundleCollectorTracer"
import { parseScannerResult } from "./parseScannerResult"
import { debug_traceCall } from "./tracer"
export interface IValidator {
    getExecutionResult(userOperation: UserOperation, usingTenderly?: boolean): Promise<ExecutionResult>
    getValidationResult(userOperation: UserOperation, usingTenderly?: boolean): Promise<ValidationResult>
    validateUserOperation(userOperation: UserOperation, usingTenderly?: boolean): Promise<ValidationResult>
}

// let id = 0

async function simulateTenderlyCall(publicClient: PublicClient, params: any) {
    const response = await publicClient.transport.request({ method: "eth_call", params }).catch((e) => {
        return e
    })

    const parsedObject = z
        .object({
            cause: z.object({
                data: z.object({
                    data: hexDataSchema
                })
            })
        })
        .parse(response)

    return parsedObject.cause.data.data
}

async function getSimulationResult(errorResult: unknown, logger: Logger, desiredErrorName: "ValidationResult" | "ExecutionResult", usingTenderly = false) {
    const entryPointErrorSchemaParsing = usingTenderly ? entryPointErrorsSchema.safeParse(errorResult) : entryPointExecutionErrorSchema.safeParse(errorResult)
    if (!entryPointErrorSchemaParsing.success) {
        const err = fromZodError(entryPointErrorSchemaParsing.error)
        logger.error(
            { error: err.message },
            "unexpected error during valiation"
        )
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

    if (errorData.errorName !== desiredErrorName) {
        throw new Error(`Unexpected error - errorName is not ${desiredErrorName}`)
    }

    const simulationResult = errorData.args

    return simulationResult
}

export class UnsafeValidator implements IValidator {
    publicClient: PublicClient
    entryPoint: Address
    logger: Logger
    usingTenderly: boolean

    constructor(publicClient: PublicClient, entryPoint: Address, logger: Logger, usingTenderly = false) {
        this.publicClient = publicClient
        this.entryPoint = entryPoint
        this.logger = logger
        this.usingTenderly = usingTenderly
    }

    _parseErrorResult(userOp: UserOperation, errorResult: { errorName: string, errorArgs: any }): ValidationResult {
        if (!errorResult?.errorName?.startsWith('ValidationResult')) {
            // parse it as FailedOp
            // if its FailedOp, then we have the paymaster param... otherwise its an Error(string)
            let paymaster = errorResult.errorArgs.paymaster
            if (paymaster === zeroAddress) {
                paymaster = undefined
            }
            // eslint-disable-next-line
            const msg: string = errorResult.errorArgs?.reason ?? errorResult.toString()

            if (paymaster == null) {
                throw new RpcError(`account validation failed: ${msg}`, ValidationErrors.SimulateValidation)
            } else {
                throw new RpcError(`paymaster validation failed: ${msg}`, ValidationErrors.SimulatePaymasterValidation, { paymaster })
            }
        }

        const [
            returnInfo,
            senderInfo,
            factoryInfo,
            paymasterInfo,
            // aggregatorInfo // may be missing (exists only SimulationResultWithAggregator
        ] = errorResult.errorArgs

        // extract address from "data" (first 20 bytes)
        // add it as "addr" member to the "stakeinfo" struct
        // if no address, then return "undefined" instead of struct.
        function fillEntity(data: string, info: StakeInfo): StakeInfo | undefined {
            const addr = getAddress(data.slice(0, 42))
            return addr == null
                ? undefined
                : {
                    ...info,
                    addr
                }
        }

        return {
            returnInfo,
            senderInfo: {
                ...senderInfo,
                addr: userOp.sender
            },
            factoryInfo: fillEntity(userOp.initCode === "0x" ? zeroAddress : userOp.initCode, factoryInfo) as any,
            paymasterInfo: fillEntity(userOp.paymasterAndData === "0x" ? zeroAddress : userOp.paymasterAndData, paymasterInfo) as any,
            // aggregatorInfo: fillEntity(aggregatorInfo?.actualAggregator, aggregatorInfo?.stakeInfo)
        }
    }

    async simulateValidation(userOperation: UserOperation): Promise<[ValidationResult, BundlerCollectorReturn]> {
        const simulateCall = encodeFunctionData({ abi: EntryPointAbi, functionName: "simulateValidation", args: [userOperation] })

        const tracerResult: BundlerCollectorReturn = await debug_traceCall(this.publicClient, {
            from: zeroAddress,
            to: this.entryPoint,
            data: simulateCall,
        }, { tracer: bundlerCollectorTracer })

        const lastResult = tracerResult.calls.slice(-1)[0]
        if (lastResult.type !== 'REVERT') {
            throw new Error('Invalid response. simulateCall must revert')
        }
        const data = (lastResult as ExitInfo).data
        // Hack to handle SELFDESTRUCT until we fix entrypoint
        if (data === '0x') {
            return [data as any, tracerResult]
        }

        try {
            const {
                errorName,
                args: errorArgs
            } = decodeErrorResult({ abi: EntryPointAbi, data: data as `0x${string}` })

            const errFullName = `${errorName}(${errorArgs.toString()})`
            const errorResult = this._parseErrorResult(userOperation, {
                errorName,
                errorArgs
            })

            
            if (!errorName.includes('Result')) {
                // a real error, not a result.
                throw new Error(errFullName)
            }
            
            // errorResult is "ValidationResult"
            return [errorResult, tracerResult]
        } catch (e: any) {
            // if already parsed, throw as is
            if (e.code != null) {
                throw e
            }

            // not a known error of EntryPoint (probably, only Error(string), since FailedOp is handled above)
            // const err = decodeErrorReason(data
            throw new RpcError("factory", ValidationErrors.OpcodeValidation)
            // throw new RpcError(err != null ? err.message : data, 111)
        }
    }

    async getExecutionResult(userOperation: UserOperation): Promise<ExecutionResult> {
        const entryPointContract = getContract({
            address: this.entryPoint,
            abi: EntryPointAbi,
            publicClient: this.publicClient
        })

        if (this.usingTenderly) {
            const tenderlyResult = await simulateTenderlyCall(this.publicClient, [
                {
                    to: this.entryPoint,
                    data: encodeFunctionData({
                        abi: entryPointContract.abi,
                        functionName: "simulateHandleOp",
                        args: [userOperation, "0x0000000000000000000000000000000000000000", "0x"]
                    })
                },
                "latest"
            ])

            const errorResult = decodeErrorResult({
                abi: entryPointContract.abi,
                data: tenderlyResult
            })

            // @ts-ignore
            return getSimulationResult(errorResult, this.logger, "ExecutionResult", this.usingTenderly)
        } else {
            const errorResult = await entryPointContract.simulate
                .simulateHandleOp([userOperation, "0x0000000000000000000000000000000000000000", "0x"])
                .catch((e) => {
                    if (e instanceof Error) {
                        return e
                    } else {
                        throw e
                    }
                })

            // @ts-ignore
            return getSimulationResult(errorResult, this.logger, "ExecutionResult", this.usingTenderly)
        }
    }

    async getValidationResult(userOperation: UserOperation): Promise<ValidationResult> {
        const entryPointContract = getContract({
            address: this.entryPoint,
            abi: EntryPointAbi,
            publicClient: this.publicClient
        })

        if (this.usingTenderly) {
            const tenderlyResult = await simulateTenderlyCall(this.publicClient, [
                {
                    to: this.entryPoint,
                    data: encodeFunctionData({
                        abi: entryPointContract.abi,
                        functionName: "simulateValidation",
                        args: [userOperation]
                    })
                },
                "latest"
            ])

            const errorResult = decodeErrorResult({
                abi: entryPointContract.abi,
                data: tenderlyResult
            })

            // @ts-ignore
            return getSimulationResult(errorResult, this.logger, "ValidationResult", this.usingTenderly)
        } else {
            const errorResult = await entryPointContract.simulate.simulateValidation([userOperation]).catch((e) => {
                if (e instanceof Error) {
                    return e
                } else {
                    throw e
                }
            })

            // @ts-ignore
            return getSimulationResult(errorResult, this.logger, "ValidationResult", this.usingTenderly)
        }
    }

    async validateUserOperation(userOperation: UserOperation): Promise<ValidationResult> {
        // const validationResult = await this.getValidationResult(userOperation)

        const [validationResult, tracerResult] = await this.simulateValidation(userOperation);
        await parseScannerResult(userOperation, tracerResult, validationResult, this.entryPoint);

        if (validationResult.returnInfo.sigFailed) {
            throw new RpcError("Invalid UserOp signature or paymaster signature", ValidationErrors.InvalidSignature)
        }

        if (validationResult.returnInfo.validUntil < Date.now() / 1000 + 30) {
            throw new RpcError("expires too soon", ValidationErrors.ExpiresShortly)
        }

        return validationResult
    }
}
