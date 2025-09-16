import { UserOpInfo, HexData32, UserOperation } from "@alto/types"

export type ConflictingOutstandingType =
    | {
          reason: "conflicting_nonce" | "conflicting_deployment"
          userOpInfo: UserOpInfo
      }
    | undefined

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

export { createMemoryOutstandingQueue } from "./createMemoryOutstandingStore"
export { createRedisOutstandingQueue } from "./createRedisOutstandingStore"
