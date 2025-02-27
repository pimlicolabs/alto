import type {
    Address,
    HexData32,
    SubmittedUserOp,
    UserOpInfo
} from "@alto/types"

// Define the StoreType type
export type StoreType = "outstanding" | "processing" | "submitted"
export type UserOpType = UserOpInfo | SubmittedUserOp

type EntryPointUserOpPair = {
    entryPoint: Address
    userOp: UserOpInfo
}

type EntryPointSubmittedUserOpPair = {
    entryPoint: Address
    userOp: SubmittedUserOp
}

type EntryPointUserOpHashPair = {
    entryPoint: Address
    userOp: UserOpType
}

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export type MempoolStore = {
    // Methods used for bundling
    peekOutstanding: (args: { entryPoint: Address }) => Promise<
        UserOpInfo | undefined
    >
    popOutstanding: (args: { entryPoint: Address }) => Promise<
        UserOpInfo | undefined
    >

    // State handling
    addOutstanding: (args: EntryPointUserOpPair) => Promise<void>
    addProcessing: (args: EntryPointUserOpPair) => Promise<void>
    addSubmitted: (args: EntryPointSubmittedUserOpPair) => Promise<void>

    removeOutstanding: (args: EntryPointUserOpHashPair) => Promise<void>
    removeProcessing: (args: EntryPointUserOpHashPair) => Promise<void>
    removeSubmitted: (args: EntryPointUserOpHashPair) => Promise<void>

    dumpOutstanding: (arsg: { entryPoint: Address }) => Promise<UserOpInfo[]>
    dumpProcessing: (args: { entryPoint: Address }) => Promise<UserOpInfo[]>
    dumpSubmitted: (args: { entryPoint: Address }) => Promise<SubmittedUserOp[]>

    // Misc
    clear: (entryPoint: Address, from: StoreType) => Promise<void>
}

export type BaseStore<T extends UserOpType> = {
    remove: (args: { userOpHash: HexData32 }) => Promise<boolean>
    dump: () => Promise<T[]>
    length: () => Promise<number>
    clear: () => Promise<void>
}

export type Store<T extends UserOpType> = BaseStore<T> & {
    add: (args: { userOpInfo: T }) => Promise<void>
}

export type OutstandingStore = BaseStore<UserOpInfo> & {
    add: (args: { userOpInfo: UserOpInfo }) => Promise<void>
    peek: () => Promise<UserOpInfo | undefined>
    pop: () => Promise<UserOpInfo | undefined>
}

export { createMempoolStore } from "./createMempoolStore"
