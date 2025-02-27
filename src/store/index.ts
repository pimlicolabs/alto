import type { HexData32, SubmittedUserOp, UserOpInfo } from "@alto/types"

// Define the StoreType type
export type StoreType = "outstanding" | "processing" | "submitted"
export type UserOpType = UserOpInfo | SubmittedUserOp

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export type MempoolStore = {
    addOutstanding: (userOpInfo: UserOpInfo) => Promise<void>
    addProcessing: (userOpInfo: UserOpInfo) => Promise<void>
    addSubmitted: (submittedUserOp: SubmittedUserOp) => Promise<void>
    removeOutstanding: (userOpHash: HexData32) => Promise<void>
    removeProcessing: (userOpHash: HexData32) => Promise<void>
    removeSubmitted: (userOpHash: HexData32) => Promise<void>
    dumpOutstanding: () => Promise<UserOpInfo[]>
    dumpProcessing: () => Promise<UserOpInfo[]>
    dumpSubmitted: () => Promise<SubmittedUserOp[]>
    clear: (from: StoreType) => Promise<void>
}

export type Store<T extends UserOpType> = {
    add: (userOpInfo: T) => Promise<void>
    remove: (userOpHash: HexData32) => Promise<boolean>
    dump: () => Promise<T[]>
    length: () => Promise<number>
    clear: () => Promise<void>
}

export type OutstandingStore = Store<UserOpInfo> & {
    pop: () => Promise<UserOpInfo | undefined>
}

export { createMempoolStore as createMemoryStore } from "./createMempoolStore"
export { createRedisStore } from "./createRedisStore"
