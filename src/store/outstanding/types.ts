import type { HexData32, UserOpInfo, UserOperation } from "@alto/types"

export type ConflictingOutstandingType =
    | {
          conflictReason:
              | "conflicting_nonce"
              | "conflicting_deployment"
              | "conflicting_7702_auth"
          userOpInfo: UserOpInfo
      }
    | undefined

export interface OutstandingStore {
    contains(userOpHash: HexData32): Promise<boolean>
    pop(count: number): Promise<UserOpInfo[]>
    popConflicting(userOp: UserOperation): Promise<ConflictingOutstandingType>
    add(userOpInfos: UserOpInfo[]): Promise<void>
    remove(userOpHash: HexData32[]): Promise<UserOpInfo[]>
    getQueuedUserOps(userOp: UserOperation): Promise<UserOperation[]>
    dumpLocal(): Promise<UserOpInfo[]>
    clear(): Promise<void>
    validateQueuedLimit(userOp: UserOperation): boolean
    validateParallelLimit(userOp: UserOperation): boolean
}
