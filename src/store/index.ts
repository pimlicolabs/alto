import type {
    Address,
    HexData32,
    SubmittedUserOp,
    UserOpInfo
} from "@alto/types"

// Define the StoreType type
export type StoreType = "outstanding" | "processing" | "submitted"
export type UserOpType = UserOpInfo | SubmittedUserOp

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export type MempoolStore = {
    // Methods used for bundling
    peekOutstanding: (entryPoint: Address) => Promise<UserOpInfo | undefined>
    popOutstanding: (entryPoint: Address) => Promise<UserOpInfo | undefined>

    // State handling
    addOutstanding: (
        entryPoint: Address,
        userOpInfo: UserOpInfo
    ) => Promise<void>
    addProcessing: (
        entryPoint: Address,
        userOpInfo: UserOpInfo
    ) => Promise<void>
    addSubmitted: (
        entryPoint: Address,
        submittedUserOp: SubmittedUserOp
    ) => Promise<void>

    removeOutstanding: (
        entryPoint: Address,
        userOpHash: HexData32
    ) => Promise<void>
    removeProcessing: (
        entryPoint: Address,
        userOpHash: HexData32
    ) => Promise<void>
    removeSubmitted: (
        entryPoint: Address,
        userOpHash: HexData32
    ) => Promise<void>

    dumpOutstanding: (entryPoint: Address) => Promise<UserOpInfo[]>
    dumpProcessing: (entryPoint: Address) => Promise<UserOpInfo[]>
    dumpSubmitted: (entryPoint: Address) => Promise<SubmittedUserOp[]>

    // Misc
    clear: (entryPoint: Address, from: StoreType) => Promise<void>
}

export type BaseStore<T extends UserOpType> = {
    remove: (userOpHash: HexData32) => Promise<boolean>
    dump: () => Promise<T[]>
    length: () => Promise<number>
    clear: () => Promise<void>
}

export type Store<T extends UserOpType> = BaseStore<T> & {
    add: (userOpInfo: T) => Promise<void>
}

export type OutstandingStore = BaseStore<UserOpInfo> & {
    add: (userOpInfo: UserOpInfo) => Promise<void>
    peek: () => Promise<UserOpInfo | undefined>
    pop: () => Promise<UserOpInfo | undefined>
}

export { createMempoolStore } from "./createMempoolStore"
