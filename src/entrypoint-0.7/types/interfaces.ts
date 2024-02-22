import type { ReferencedCodeHashes } from "./mempool"
import type { StateOverrides, UnPackedUserOperation } from "./schemas"
import type {
    ExecutionResult,
    StorageMap,
    ValidationResult,
    ValidationResultWithAggregation
} from "./validation"

export interface InterfaceValidator {
    getExecutionResult(
        userOperation: UnPackedUserOperation,
        stateOverrides?: StateOverrides
    ): Promise<ExecutionResult>
    getValidationResult(
        userOperation: UnPackedUserOperation,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
    validatePreVerificationGas(
        userOperation: UnPackedUserOperation
    ): Promise<void>
    validateUserOperation(
        userOperation: UnPackedUserOperation,
        referencedContracts?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
}
