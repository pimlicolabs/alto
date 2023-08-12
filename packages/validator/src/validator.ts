import {
    Address,
    EntryPointAbi,
    ExecutionResult,
    RpcError,
    UserOperation,
    ValidationErrors,
    entryPointErrorsSchema,
    entryPointExecutionErrorSchema
} from "@alto/types"
import { ValidationResult } from "@alto/types"
import { Logger } from "@alto/utils"
import { PublicClient, getContract, encodeFunctionData, decodeErrorResult, Account } from "viem"
import { hexDataSchema } from "@alto/types"
import { z } from "zod"
import { fromZodError } from "zod-validation-error"
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

    console.log("error", JSON.stringify(response))

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

async function getSimulationResult(
    errorResult: unknown,
    logger: Logger,
    desiredErrorName: "ValidationResult" | "ExecutionResult",
    usingTenderly = false
) {
    const entryPointErrorSchemaParsing = usingTenderly
        ? entryPointErrorsSchema.safeParse(errorResult)
        : entryPointExecutionErrorSchema.safeParse(errorResult)
    if (!entryPointErrorSchemaParsing.success) {
        const err = fromZodError(entryPointErrorSchemaParsing.error)
        logger.error({ error: err.message }, "unexpected error during valiation")
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
    utilityWallet: Account
    usingTenderly: boolean

    constructor(
        publicClient: PublicClient,
        entryPoint: Address,
        logger: Logger,
        utilityWallet: Account,
        usingTenderly = false
    ) {
        this.publicClient = publicClient
        this.entryPoint = entryPoint
        this.logger = logger
        this.utilityWallet = utilityWallet
        this.usingTenderly = usingTenderly
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
                .simulateHandleOp([userOperation, "0x0000000000000000000000000000000000000000", "0x"], {
                    account: this.utilityWallet
                })
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
        const validationResult = await this.getValidationResult(userOperation)

        if (validationResult.returnInfo.sigFailed) {
            throw new RpcError("Invalid UserOp signature or paymaster signature", ValidationErrors.InvalidSignature)
        }

        if (validationResult.returnInfo.validUntil < Date.now() / 1000 + 30) {
            throw new RpcError("expires too soon", ValidationErrors.ExpiresShortly)
        }

        return validationResult
    }
}
