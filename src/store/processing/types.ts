import type { UserOperation } from "@alto/types"
import type { Hex } from "viem"

export interface ProcessingStore {
    startProcessing(userOp: UserOperation): Promise<void>
    finishProcessing(userOpHash: Hex): Promise<void>
    isProcessing(userOpHash: Hex): Promise<boolean>
    findConflict(userOp: UserOperation): Promise<
        | {
              conflictingHash?: Hex
              reason?: "nonce_conflict" | "deployment_conflict"
          }
        | undefined
    >
}
