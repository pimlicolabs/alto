import type { Address } from "viem"
import type { ReferencedCodeHashes } from "./mempool"
import type {
    StateOverrides,
    UserOperation,
    UserOperationV06,
    UserOperationV07
} from "./schemas"
import type {
    ExecutionResult,
    StorageMap,
    ValidationResult,
    ValidationResultWithAggregation
} from "./validation"

export interface InterfaceValidator {
    getExecutionResult(
        userOperation: UserOperation,
        entryPoint: Address,
        stateOverrides?: StateOverrides
    ): Promise<ExecutionResult>
    getValidationResultV06(
        userOperation: UserOperationV06,
        entryPoint: Address,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
    getValidationResultV07(
        userOperation: UserOperationV07,
        entryPoint: Address,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
    getValidationResult(
        userOperation: UserOperation,
        entryPoint: Address,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
    validatePreVerificationGas(
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<void>
    validateUserOperation(
        userOperation: UserOperation,
        entryPoint: Address,
        referencedContracts?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
}
