import type { Address } from "viem"
import type { ReferencedCodeHashes } from "./mempool"
import type {
    StateOverrides,
    UserOperation,
    UserOperationV06,
    UserOperationV07
} from "./schemas"
import type * as validation from "./validation"
import type { SimulateHandleOpResult } from "../rpc/estimation/types"

export interface InterfaceValidator {
    getExecutionResult(
        userOperation: UserOperation,
        entryPoint: Address,
        queuedUserOperations: UserOperation[],
        balanceOverrideEnabled?: boolean,
        stateOverrides?: StateOverrides
    ): Promise<SimulateHandleOpResult<"execution">>
    getValidationResultV06(
        userOperation: UserOperationV06,
        entryPoint: Address,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (
            | validation.ValidationResult
            | validation.ValidationResultWithAggregation
        ) & {
            storageMap: validation.StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
    getValidationResultV07(
        userOperation: UserOperationV07,
        queuedUserOperations: UserOperation[],
        entryPoint: Address,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (
            | validation.ValidationResult
            | validation.ValidationResultWithAggregation
        ) & {
            storageMap: validation.StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
    getValidationResult(
        userOperation: UserOperation,
        queuedUserOperations: UserOperation[],
        entryPoint: Address,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (
            | validation.ValidationResult
            | validation.ValidationResultWithAggregation
        ) & {
            storageMap: validation.StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
    validatePreVerificationGas(
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<void>
    validateUserOperation(
        shouldCheckPrefund: boolean,
        userOperation: UserOperation,
        queuedUserOperations: UserOperation[],
        entryPoint: Address,
        referencedContracts?: ReferencedCodeHashes
    ): Promise<
        (
            | validation.ValidationResult
            | validation.ValidationResultWithAggregation
        ) & {
            storageMap: validation.StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
}
