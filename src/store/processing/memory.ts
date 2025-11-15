import type { UserOpInfo, UserOperation } from "@alto/types"
import { isDeployment } from "@alto/utils"
import type { Address, Hex } from "viem"
import type { ProcessingStore } from "./types"

export class InMemoryProcessingStore implements ProcessingStore {
    // Use Sets for boolean membership tracking (matching Redis store)
    private readonly processingUserOpsSet = new Set<Hex>()
    private readonly processingSenderNonceSet = new Set<string>()
    private readonly processingDeploymentSet = new Set<Address>()

    private encodeSenderNonceId(sender: Address, nonce: bigint): string {
        return `${sender}:${nonce}`
    }

    async addProcessing(userOpInfo: UserOpInfo): Promise<void> {
        const { userOpHash, userOp } = userOpInfo
        const isDeploymentOp = isDeployment(userOp)
        const senderNonceId = this.encodeSenderNonceId(
            userOp.sender,
            userOp.nonce
        )

        // Add to processing sets
        this.processingUserOpsSet.add(userOpHash)
        this.processingSenderNonceSet.add(senderNonceId)

        if (isDeploymentOp) {
            this.processingDeploymentSet.add(userOp.sender)
        }
    }

    async removeProcessing(userOpInfo: UserOpInfo): Promise<void> {
        const { userOpHash, userOp } = userOpInfo
        const senderNonceId = this.encodeSenderNonceId(
            userOp.sender,
            userOp.nonce
        )

        // Remove from all sets
        this.processingUserOpsSet.delete(userOpHash)
        this.processingSenderNonceSet.delete(senderNonceId)
        this.processingDeploymentSet.delete(userOp.sender)
    }

    async isProcessing(userOpHash: Hex): Promise<boolean> {
        return this.processingUserOpsSet.has(userOpHash)
    }

    async wouldConflict(
        userOp: UserOperation
    ): Promise<"nonce_conflict" | "deployment_conflict" | undefined> {
        const isDeploymentOp = isDeployment(userOp)
        const senderNonceId = this.encodeSenderNonceId(
            userOp.sender,
            userOp.nonce
        )

        // Check deployment conflict first
        if (isDeploymentOp && this.processingDeploymentSet.has(userOp.sender)) {
            return "deployment_conflict"
        }

        // Check nonce conflict
        if (this.processingSenderNonceSet.has(senderNonceId)) {
            return "nonce_conflict"
        }

        return undefined
    }
}
