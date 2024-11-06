import type {
    HexData32,
    SubmittedUserOperation,
    UserOperationInfo
} from "@alto/types"

export type Store = {
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
        {
            maxTime,
            maxGasLimit
        }: {
            maxTime?: number
            maxGasLimit: bigint
        },
        callback: (ops: UserOperationInfo[]) => void | Promise<void>
    ) => () => void
}

export { createMemoryStore } from "./createMemoryStore"
export { createRedisStore } from "./createRedisStore"
