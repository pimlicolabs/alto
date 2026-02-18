import type { UserOpInfo, UserOperation } from "@alto/types"
import { isDeployment } from "@alto/utils"
import type { Address, Hex } from "viem"
import type { ConflictType } from "../types"
import type { ProcessingStore } from "./types"

export class InMemoryProcessingStore implements ProcessingStore {
    // Use Sets for boolean membership tracking (matching Redis store)
    private readonly processingUserOpsSet = new Set<Hex>()
    private readonly processingSenderNonceSet = new Set<string>()
    private readonly processingDeploymentSet = new Set<Address>()
    private readonly processingEip7702AuthSet = new Set<Address>()

    // Map for full UserOpInfo storage (for shutdown recovery)
    private readonly processingUserOps = new Map<Hex, UserOpInfo>()

    private encodeSenderNonceId(sender: Address, nonce: bigint): string {
        return `${sender}:${nonce}`
    }

    async addProcessing(userOpInfos: UserOpInfo[]): Promise<void> {
        for (const userOpInfo of userOpInfos) {
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

            if (userOp.eip7702Auth) {
                this.processingEip7702AuthSet.add(userOp.sender)
            }

            // Store full UserOpInfo for shutdown recovery
            this.processingUserOps.set(userOpHash, userOpInfo)
        }
    }

    async removeProcessing(userOpInfos: UserOpInfo[]): Promise<void> {
        if (userOpInfos.length === 0) return

        for (const userOpInfo of userOpInfos) {
            const { userOpHash, userOp } = userOpInfo
            const senderNonceId = this.encodeSenderNonceId(
                userOp.sender,
                userOp.nonce
            )

            // Remove from all sets
            this.processingUserOpsSet.delete(userOpHash)
            this.processingSenderNonceSet.delete(senderNonceId)
            this.processingDeploymentSet.delete(userOp.sender)

            if (userOp.eip7702Auth) {
                this.processingEip7702AuthSet.delete(userOp.sender)
            }

            // Remove from Map
            this.processingUserOps.delete(userOpHash)
        }
    }

    async isProcessing(userOpHash: Hex): Promise<boolean> {
        return this.processingUserOpsSet.has(userOpHash)
    }

    async wouldConflict(
        userOp: UserOperation
    ): Promise<ConflictType | undefined> {
        const isDeploymentOp = isDeployment(userOp)
        const senderNonceId = this.encodeSenderNonceId(
            userOp.sender,
            userOp.nonce
        )

        // Check deployment conflict first
        if (isDeploymentOp && this.processingDeploymentSet.has(userOp.sender)) {
            return "conflicting_deployment"
        }

        // Check EIP-7702 auth conflict
        if (
            userOp.eip7702Auth &&
            this.processingEip7702AuthSet.has(userOp.sender)
        ) {
            return "conflicting_7702_auth"
        }

        // Check nonce conflict
        if (this.processingSenderNonceSet.has(senderNonceId)) {
            return "conflicting_nonce"
        }

        return undefined
    }

    async flush(): Promise<UserOpInfo[]> {
        // get all userOps before clearing sets
        const userOpInfos = Array.from(this.processingUserOps.values())
        await this.removeProcessing(userOpInfos)
        return userOpInfos
    }

}
