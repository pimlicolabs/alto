import type { HexData32, SubmittedUserOp, UserOpInfo } from "@alto/types"

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export type Store = {
    addOutstanding: (userOpInfo: UserOpInfo) => Promise<void>
    addProcessing: (userOpInfo: UserOpInfo) => Promise<void>
    addSubmitted: (submittedUserOp: SubmittedUserOp) => Promise<void>
    removeOutstanding: (userOpHash: HexData32) => Promise<void>
    removeProcessing: (userOpHash: HexData32) => Promise<void>
    removeSubmitted: (userOpHash: HexData32) => Promise<void>
    dumpOutstanding: () => Promise<UserOpInfo[]>
    dumpProcessing: () => Promise<UserOpInfo[]>
    dumpSubmitted: () => Promise<SubmittedUserOp[]>
    clear: (from: "outstanding" | "processing" | "submitted") => Promise<void>
}

export { createMemoryStore } from "./createMemoryStore"
export { createRedisStore } from "./createRedisStore"
