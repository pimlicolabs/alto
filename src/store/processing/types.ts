import type { UserOpInfo, UserOperation } from "@alto/types"
import type { Hex } from "viem"
import type { ConflictType } from "../types"

export interface ProcessingStore {
    addProcessing(userOpInfos: UserOpInfo[]): Promise<void>
    removeProcessing(userOpInfos: UserOpInfo[]): Promise<void>
    isProcessing(userOpHash: Hex): Promise<boolean>
    wouldConflict(userOp: UserOperation): Promise<ConflictType | undefined>
    getAll(): UserOpInfo[]
    flush(): Promise<UserOpInfo[]>
}
