import type { UserOpInfo, UserOperation } from "@alto/types"
import type { Hex } from "viem"

export interface ProcessingStore {
    addProcessing(userOp: UserOpInfo): Promise<void>
    removeProcessing(userOp: UserOpInfo): Promise<void>
    isProcessing(userOpHash: Hex): Promise<boolean>
    wouldConflict(
        userOp: UserOperation
    ): Promise<"nonce_conflict" | "deployment_conflict" | undefined>
}
