import type {
    HexData32,
    SubmittedUserOperation,
    UserOperationInfo
} from "@alto/types"

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export type Store<T extends Record<string, unknown> = {}> = T & {
    addOutstanding: (op: UserOperationInfo) => Promise<void>
    addProcessing: (op: UserOperationInfo) => Promise<void>
    addSubmitted: (op: SubmittedUserOperation) => Promise<void>
    removeOutstanding: (userOpHash: HexData32) => Promise<void>
    removeProcessing: (userOpHash: HexData32) => Promise<void>
    removeSubmitted: (userOpHash: HexData32) => Promise<void>
    dumpOutstanding: (processOps?: boolean) => Promise<UserOperationInfo[]>
    dumpProcessing: () => Promise<UserOperationInfo[]>
    dumpSubmitted: () => Promise<SubmittedUserOperation[]>
    clear: (from: "outstanding" | "processing" | "submitted") => Promise<void>
    process: (
        args: {
            maxGasLimit: bigint
            maxTime?: number
            immediate?: boolean
        },
        callback: (ops: UserOperationInfo[]) => void | Promise<void>
    ) => () => void
}

export { createMemoryStore } from "./createMemoryStore"
export { createRedisStore } from "./createRedisStore"
