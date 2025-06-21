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
    peekOutstanding: (entryPoint: Address) => Promise<UserOpInfo | undefined>
    popOutstanding: (entryPoint: Address) => Promise<UserOpInfo | undefined>

    // Methods for state handling.
    addOutstanding: (args: EntryPointUserOpInfoParam) => Promise<void>
    addProcessing: (args: EntryPointUserOpInfoParam) => Promise<void>
    addSubmitted: (args: EntryPointUserOpInfoParam) => Promise<void>

    removeOutstanding: (args: EntryPointUserOpHashParam) => Promise<void>
    removeProcessing: (args: EntryPointUserOpHashParam) => Promise<void>
    removeSubmitted: (args: EntryPointUserOpHashParam) => Promise<void>

    dumpOutstanding: (entryPoint: Address) => Promise<UserOpInfo[]>
    dumpProcessing: (entryPoint: Address) => Promise<UserOpInfo[]>
    dumpSubmitted: (entryPoint: Address) => Promise<UserOpInfo[]>

    // Methods for userOp validation before adding to mempool.
    isInMempool: (args: EntryPointUserOpHashParam) => Promise<boolean>
    popConflictingOustanding: (args: {
        entryPoint: Address
        userOp: UserOperation
    }) => Promise<ConflictingOutstandingType>
    validateSubmittedOrProcessing: (
        args: EntryPointUserOpParam
    ) => Promise<ValidationResult>
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

export type BaseStore = {
    add: (op: UserOpInfo) => Promise<void>
    remove: (userOpHash: HexData32) => Promise<boolean>
    contains: (userOpHash: HexData32) => Promise<boolean>
    dumpLocal: () => Promise<UserOpInfo[]>
}

export type Store = BaseStore & {
    findConflicting: (args: UserOperation) => Promise<ConflictingStoreType>
}

export type OutstandingStore = BaseStore & {
    clear: () => Promise<void>
    // Will remove and return the first conflicting userOpInfo
    popConflicting: (args: UserOperation) => Promise<ConflictingOutstandingType>
    validateQueuedLimit: (userOp: UserOperation) => boolean
    validateParallelLimit: (userOp: UserOperation) => boolean
    getQueuedUserOps: (userOp: UserOperation) => Promise<UserOperation[]>
    peek: () => Promise<UserOpInfo | undefined>
    pop: () => Promise<UserOpInfo | undefined>
}

export { createMempoolStore } from "./createMempoolStore"
