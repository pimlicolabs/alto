import type { HexData32, UserOpInfo, UserOperation } from "@alto/types"

export type ConflictingOutstandingType =
    | {
          reason: "conflicting_nonce" | "conflicting_deployment"
          userOpInfo: UserOpInfo
      }
    | undefined

export interface OutstandingStore {
    contains(userOpHash: HexData32): Promise<boolean>
    pop(): Promise<UserOpInfo | undefined>
    popConflicting(userOp: UserOperation): Promise<ConflictingOutstandingType>
    add(userOpInfo: UserOpInfo): Promise<void>
    remove(userOpHash: HexData32): Promise<boolean>
    getQueuedUserOps(userOp: UserOperation): Promise<UserOperation[]>
    dumpLocal(): Promise<UserOpInfo[]>
    clear(): Promise<void>
    validateQueuedLimit(userOp: UserOperation): boolean
    validateParallelLimit(userOp: UserOperation): boolean
}

