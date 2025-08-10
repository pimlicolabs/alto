import type { Address } from "viem"
import type { SimulateHandleOpResult } from "../rpc/estimation/types"
import type {
    ReferencedCodeHashes,
    StateOverrides,
    UserOperation,
    UserOperation06,
    UserOperation07
} from "./schemas"
import type * as validation from "./validation"

export interface InterfaceValidator {
    validateHandleOp(args: {
        userOp: UserOperation
        entryPoint: Address
        queuedUserOps: UserOperation[]
        stateOverrides?: StateOverrides
    }): Promise<{
        callGasLimit: bigint
        verificationGasLimit: bigint
        paymasterVerificationGasLimit: bigint | null
        paymasterPostOpGasLimit: bigint | null
    }>

    getExecutionResult(args: {
        userOp: UserOperation
        entryPoint: Address
        queuedUserOps: UserOperation[]
        stateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult>

    getValidationResultV06(args: {
        userOp: UserOperation06
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        validation.ValidationResult & {
            storageMap: validation.StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >

    getValidationResultV07(args: {
        userOp: UserOperation07
        queuedUserOps: UserOperation[]
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        validation.ValidationResult & {
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
        validation.ValidationResult & {
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
        validation.ValidationResult & {
            storageMap: validation.StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    >
}
