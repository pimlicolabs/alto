import type { Address } from "viem"
import type { SimulateHandleOpResult } from "../rpc/estimation/types"
import type {
    ReferencedCodeHashes,
    StateOverrides,
    UserOperation,
    UserOperationV06,
    UserOperationV07
} from "./schemas"
import type * as validation from "./validation"

export interface InterfaceValidator {
    validateHandleOp(args: {
        userOp: UserOperation
        entryPoint: Address
        queuedUserOps: UserOperation[]
        stateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult>

    getExecutionResult(args: {
        userOp: UserOperation
        entryPoint: Address
        queuedUserOps: UserOperation[]
        stateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult>

    getValidationResultV06(args: {
        userOp: UserOperationV06
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        (
            | validation.ValidationResult
            | validation.ValidationResultWithAggregation
        ) & {
            storageMap: validation.StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >

    getValidationResultV07(args: {
        userOp: UserOperationV07
        queuedUserOps: UserOperation[]
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        (
            | validation.ValidationResult
            | validation.ValidationResultWithAggregation
        ) & {
            storageMap: validation.StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >

    getValidationResult(args: {
        userOp: UserOperation
        queuedUserOps: UserOperation[]
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        (
            | validation.ValidationResult
            | validation.ValidationResultWithAggregation
        ) & {
            storageMap: validation.StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >

    validateUserOp(args: {
        userOp: UserOperation
        queuedUserOps: UserOperation[]
        entryPoint: Address
        referencedContracts?: ReferencedCodeHashes
    }): Promise<
        (
            | validation.ValidationResult
            | validation.ValidationResultWithAggregation
        ) & {
            storageMap: validation.StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
}
