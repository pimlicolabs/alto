import type {
    Address,
    HexData32,
    SubmittedUserOp,
    UserOpInfo
} from "@alto/types"

// Define the StoreType type
export type StoreType = "outstanding" | "processing" | "submitted"
export type UserOpType = UserOpInfo | SubmittedUserOp

type EntryPointUserOpParam = {
    entryPoint: Address
    userOpInfo: UserOpInfo
}

type EntryPointSubmittedUserOpParam = {
    entryPoint: Address
    submittedUserOp: SubmittedUserOp
}

type EntryPointUserOpHashParam = {
    entryPoint: Address
    userOpHash: HexData32
}

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export type MempoolStore = {
    // Methods used for bundling
    peekOutstanding: (entryPoint: Address) => Promise<UserOpInfo | undefined>
    popOutstanding: (entryPoint: Address) => Promise<UserOpInfo | undefined>

    // State handling
    addOutstanding: (args: EntryPointUserOpParam) => Promise<void>
    addProcessing: (args: EntryPointUserOpParam) => Promise<void>
    addSubmitted: (args: EntryPointSubmittedUserOpParam) => Promise<void>

    removeOutstanding: (args: EntryPointUserOpHashParam) => Promise<void>
    removeProcessing: (args: EntryPointUserOpHashParam) => Promise<void>
    removeSubmitted: (args: EntryPointUserOpHashParam) => Promise<void>

    dumpOutstanding: (entryPoint: Address) => Promise<UserOpInfo[]>
    dumpProcessing: (entryPoint: Address) => Promise<UserOpInfo[]>
    dumpSubmitted: (entryPoint: Address) => Promise<SubmittedUserOp[]>

    // Misc
    clear: (args: { entryPoint: Address; from: StoreType }) => Promise<void>
}

export type BaseStore<T extends UserOpType> = {
    remove: (args: { userOpHash: HexData32 }) => Promise<boolean>
    dump: () => Promise<T[]>
    length: () => Promise<number>
    clear: () => Promise<void>
}

export type Store<T extends UserOpType> = BaseStore<T> & {
    add: (args: { op: T }) => Promise<void>
}

export type OutstandingStore = BaseStore<UserOpInfo> & {
    add: (args: { userOpInfo: UserOpInfo }) => Promise<void>
    peek: () => Promise<UserOpInfo | undefined>
    pop: () => Promise<UserOpInfo | undefined>
}

export { createMempoolStore } from "./createMempoolStore"
