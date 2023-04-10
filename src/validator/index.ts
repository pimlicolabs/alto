import { UserOp } from "../userOp"

interface ValidationResult {
    valid: boolean
    code?: number
    message?: string
    data?: any
}

export abstract class Validator {
    public abstract validate(entrypoint: string, userOp: UserOp): ValidationResult
    public abstract estimateGas(entrypoint: string, userOp: UserOp): number
}
