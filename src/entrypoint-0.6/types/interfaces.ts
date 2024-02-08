import type { ReferencedCodeHashes } from "./mempool"
import type { StateOverrides, UserOperation } from "./schemas"
import type {
    ExecutionResult,
    StorageMap,
    ValidationResult,
    ValidationResultWithAggregation
} from "./validation"

export interface InterfaceValidator {
    getExecutionResult(
        userOperation: UserOperation,
        stateOverrides?: StateOverrides
    ): Promise<ExecutionResult>
    getValidationResult(
        userOperation: UserOperation,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
    validatePreVerificationGas(userOperation: UserOperation): Promise<void>
    validateUserOperation(
        userOperation: UserOperation,
        referencedContracts?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
}
