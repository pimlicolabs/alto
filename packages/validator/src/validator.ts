import { UserOperation, Address, EntryPointAbi, RpcError, ValidationErrors } from "@alto/types"
import { PublicClient, getContract } from "viem"
import { ValidationResult, validationResultErrorSchema } from "@alto/types/src/validation"
import { fromZodError } from "zod-validation-error"
export interface IValidator {
    validateUserOp(userOperation: UserOperation): Promise<ValidationResult>
}

export class EmptyValidator implements IValidator {
    constructor(readonly publicClient: PublicClient, readonly entryPoint: Address) {}
    async validateUserOp(userOperation: UserOperation): Promise<ValidationResult> {
        const entryPointContract = getContract({
            address: this.entryPoint,
            abi: EntryPointAbi,
            publicClient: this.publicClient
        })

        const errorResult = await entryPointContract.simulate.simulateValidation([userOperation]).catch((e) => {
            if (e instanceof Error) return e
            else {
                throw e
            }
        })

        const validationResultErrorParsing = validationResultErrorSchema.safeParse(errorResult)

        if (!validationResultErrorParsing.success) {
            const err = fromZodError(validationResultErrorParsing.error)
            throw err
        }

        const validationResultError = validationResultErrorParsing.data
        const validationResult = validationResultError.cause.data.args

        if (validationResult.returnInfo.sigFailed)
            throw new RpcError("Invalid UserOp signature or paymaster signature", ValidationErrors.InvalidSignature)

        if (validationResult.returnInfo.validUntil < Date.now() / 1000 + 30)
            throw new RpcError("expires too soon", ValidationErrors.ExpiresShortly)

        return validationResult

        //return await this.memPool.add(this.entrypoint, userOp)
    }
}
