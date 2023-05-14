import { Address, EntryPointAbi, RpcError, UserOperation, ValidationErrors } from "@alto/types"
import { ValidationResult, entryPointExecutionErrorSchema } from "@alto/types"
import { PublicClient, getContract } from "viem"
import { fromZodError } from "zod-validation-error"
export interface IValidator {
    getValidationResult(userOperation: UserOperation): Promise<ValidationResult>
    validateUserOperation(userOperation: UserOperation): Promise<ValidationResult>
}

export class UnsafeValidator implements IValidator {
    publicClient: PublicClient
    entryPoint: Address

    constructor(publicClient: PublicClient, entryPoint: Address) {
        this.publicClient = publicClient
        this.entryPoint = entryPoint
    }

    async getValidationResult(userOperation: UserOperation): Promise<ValidationResult> {
        const entryPointContract = getContract({
            address: this.entryPoint,
            abi: EntryPointAbi,
            publicClient: this.publicClient
        })

        const errorResult = await entryPointContract.simulate.simulateValidation([userOperation]).catch((e) => {
            if (e instanceof Error) {
                return e
            } else {
                throw e
            }
        })

        const entryPointExecutionErrorSchemaParsing = entryPointExecutionErrorSchema.safeParse(errorResult)

        if (!entryPointExecutionErrorSchemaParsing.success) {
            const err = fromZodError(entryPointExecutionErrorSchemaParsing.error)
            err.message = `User Operation simulation returned unexpected invalid response: ${err.message}`
            throw err
        }

        const errorData = entryPointExecutionErrorSchemaParsing.data

        if (errorData.errorName === "FailedOp") {
            const reason = errorData.args.reason
            throw new RpcError(
                `UserOperation reverted during simulation with reason: ${reason}`,
                ValidationErrors.SimulateValidation
            )
        }

        if (errorData.errorName !== "ValidationResult") {
            throw new Error("Unexpected error - errorName is not ValidationResult")
        }

        const validationResult = errorData.args

        return validationResult
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
