import type {
    Address,
    HexData32,
    SubmittedUserOp,
    UserOpInfo,
    UserOperation
} from "@alto/types"

// Define the StoreType type
export type StoreType = "outstanding" | "processing" | "submitted"
export type UserOpType = UserOpInfo | SubmittedUserOp

export type ConflictingType =
    | {
          reason: "conflicting_nonce" | "conflicting_deployment"
          userOpInfo: UserOpInfo
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

export type EntryPointSubmittedUserOpParam = {
    entryPoint: Address
    submittedUserOp: SubmittedUserOp
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
    addSubmitted: (args: EntryPointSubmittedUserOpParam) => Promise<void>

    removeOutstanding: (args: EntryPointUserOpHashParam) => Promise<void>
    removeProcessing: (args: EntryPointUserOpHashParam) => Promise<void>
    removeSubmitted: (args: EntryPointUserOpHashParam) => Promise<void>

    dumpOutstanding: (entryPoint: Address) => Promise<UserOpInfo[]>
    dumpProcessing: (entryPoint: Address) => Promise<UserOpInfo[]>
    dumpSubmitted: (entryPoint: Address) => Promise<SubmittedUserOp[]>

    // Methods for userOp validation before adding to mempool.
    isInMempool: (args: EntryPointUserOpHashParam) => Promise<boolean>
    findConflictingOutstanding: (args: {
        entryPoint: Address
        userOp: UserOperation
    }) => Promise<ConflictingType>
    validateSubmittedOrProcessing: (
        args: EntryPointUserOpParam
    ) => Promise<ValidationResult>
    validateSenderLimits: (args: {
        entryPoint: Address
        userOp: UserOperation
    }) => Promise<ValidationResult>

    // Misc.
    clear: (args: { entryPoint: Address; from: StoreType }) => Promise<void>
}

export type Store<T extends UserOpType> = {
    add: (op: T) => Promise<void>
    remove: (userOpHash: HexData32) => Promise<boolean>
    contains: (userOpHash: HexData32) => Promise<boolean>
    dump: () => Promise<T[]>
    length: () => Promise<number>
    clear: () => Promise<void>
}

export type OutstandingStore = Store<UserOpInfo> & {
    validateQueuedLimit: (userOp: UserOperation) => boolean
    validateParallelLimit: (userOp: UserOperation) => boolean
    findConflicting: (args: UserOperation) => Promise<ConflictingType>
    peek: () => Promise<UserOpInfo | undefined>
    pop: () => Promise<UserOpInfo | undefined>
}

export { createMempoolStore } from "./createMempoolStore"
