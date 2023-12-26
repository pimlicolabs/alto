import { ReferencedCodeHashes } from "./mempool"
import { UserOperation } from "./schemas"
import {
    ExecutionResult,
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
        referencedContracts?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
}
