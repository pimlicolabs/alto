import type { Address, HexData32, UserOpInfo, UserOperation } from "@alto/types"

// Define the StoreType type
export type StoreType = "outstanding" | "processing" | "submitted"

export type ConflictingOutstandingType =
    | {
          reason: "conflicting_nonce" | "conflicting_deployment"
          userOpInfo: UserOpInfo
      }
    | undefined

export type ConflictingStoreType =
    | {
          reason: "conflicting_nonce" | "conflicting_deployment"
          userOp: UserOperation
      }
    | undefined

type ValidationResult =
    | {
          valid: true
      }
    | {
          valid: false
          reason: string
      }

export type EntryPointUserOpInfoParam = {
    entryPoint: Address
    userOpInfo: UserOpInfo
}

export type EntryPointUserOpHashParam = {
    entryPoint: Address
    userOpHash: HexData32
}

export type EntryPointUserOpParam = {
    userOp: UserOperation
    entryPoint: Address
}

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export type MempoolStore = {
    // Methods used for bundling.
    popOutstanding: (entryPoint: Address) => Promise<UserOpInfo | undefined>

    // Methods for state handling.
    addOutstanding: (args: EntryPointUserOpInfoParam) => Promise<void>
    removeOutstanding: (args: EntryPointUserOpHashParam) => Promise<void>
    dumpOutstanding: (entryPoint: Address) => Promise<UserOpInfo[]>

    // Conflict tracking (replaces processing/submitted pools)
    registerProcessing: (args: EntryPointUserOpInfoParam) => Promise<void>
    unregisterProcessing: (args: EntryPointUserOpHashParam) => Promise<void>

    // Methods for userOp validation before adding to mempool.
    checkDuplicatesAndConflicts: (args: {
        entryPoint: Address
        userOp: UserOperation
        userOpHash: HexData32
    }) => Promise<ValidationResult>
    popConflictingOustanding: (args: {
        entryPoint: Address
        userOp: UserOperation
    }) => Promise<ConflictingOutstandingType>
    validateSenderLimits: (args: {
        entryPoint: Address
        userOp: UserOperation
    }) => Promise<ValidationResult>

    // Misc.
    getQueuedOutstandingUserOps: (args: {
        userOp: UserOperation
        entryPoint: Address
    }) => Promise<UserOperation[]>
    clearOutstanding: (entryPoint: Address) => Promise<void>
}

export type OutstandingStore = {
    add: (op: UserOpInfo) => Promise<void>
    remove: (userOpHash: HexData32) => Promise<boolean>
    contains: (userOpHash: HexData32) => Promise<boolean>
    dumpLocal: () => Promise<UserOpInfo[]>

    clear: () => Promise<void>
    // Will remove and return the first conflicting userOpInfo
    popConflicting: (args: UserOperation) => Promise<ConflictingOutstandingType>
    validateQueuedLimit: (userOp: UserOperation) => boolean
    validateParallelLimit: (userOp: UserOperation) => boolean
    getQueuedUserOps: (userOp: UserOperation) => Promise<UserOperation[]>
    pop: () => Promise<UserOpInfo | undefined>
}

export { createMempoolStore } from "./createMempoolStore"
