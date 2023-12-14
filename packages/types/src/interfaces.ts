import { UserOperation } from "./schemas"
import {
    ExecutionResult,
    ReferencedCodeHashes,
    StorageMap,
    ValidationResult,
    ValidationResultWithAggregation
} from "./validation"

export interface IValidator {
    getExecutionResult(
        userOperation: UserOperation,
        usingTenderly?: boolean
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
    validateUserOperation(
        userOperation: UserOperation,
        usingTenderly?: boolean
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
        }
    >
}
