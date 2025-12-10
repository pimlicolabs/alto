import type { UserOpInfo, UserOperation } from "@alto/types"
import type { Hex } from "viem"
import type { ConflictType } from "../types"

export interface ProcessingStore {
    addProcessing(userOp: UserOpInfo): Promise<void>
    removeProcessing(userOp: UserOpInfo): Promise<void>
    isProcessing(userOpHash: Hex): Promise<boolean>
    wouldConflict(userOp: UserOperation): Promise<ConflictType | undefined>
}
