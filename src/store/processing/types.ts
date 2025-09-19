import type { UserOpInfo, UserOperation } from "@alto/types"
import type { Hex } from "viem"

export interface ProcessingStore {
    startProcessing(userOp: UserOpInfo): Promise<void>
    finishProcessing(userOp: UserOpInfo): Promise<void>
    isProcessing(userOpHash: Hex): Promise<boolean>
    wouldConflict(
        userOp: UserOperation
    ): Promise<"nonce_conflict" | "deployment_conflict" | undefined>
}
