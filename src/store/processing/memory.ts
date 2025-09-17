import type { Address, Hex } from "viem"
import type { AltoConfig } from "../../createConfig"
import type { UserOperation } from "@alto/types"
import { getUserOpHash, isDeployment } from "@alto/utils"
import type { ProcessingStore } from "./types"

interface Entry {
    sender: Address
    nonce: bigint
    isDeployment: boolean // Whether this op deploys the account
}

export class InMemoryProcessingStore implements ProcessingStore {
    private trackedOps = new Map<Hex, Entry>()
    private senderNonces = new Map<string, Hex>()
    private deployingSenders = new Map<Address, Hex>()
    private config: AltoConfig
    private entryPoint: Address

    constructor(config: AltoConfig, entryPoint: Address) {
        this.config = config
        this.entryPoint = entryPoint
    }

    async startProcessing(userOp: UserOperation): Promise<void> {
        const userOpHash = await getUserOpHash({
            userOp,
            entryPointAddress: this.entryPoint,
            chainId: this.config.chainId,
            publicClient: this.config.publicClient
        })

        const entry: Entry = {
            sender: userOp.sender,
            nonce: userOp.nonce,
            isDeployment: isDeployment(userOp)
        }
        this.trackedOps.set(userOpHash, entry)

        // Track by sender and nonce
        const nonceId = `${entry.sender}:${entry.nonce}`
        this.senderNonces.set(nonceId, userOpHash)

        if (entry.isDeployment) {
            this.deployingSenders.set(entry.sender, userOpHash)
        }
    }

    async finishProcessing(userOpHash: Hex): Promise<void> {
        const entry = this.trackedOps.get(userOpHash)
        if (!entry) return

        const nonceId = `${entry.sender}:${entry.nonce}`
        this.senderNonces.delete(nonceId)

        if (entry.isDeployment) {
            this.deployingSenders.delete(entry.sender)
        }

        this.trackedOps.delete(userOpHash)
    }

    async isProcessing(userOpHash: Hex): Promise<boolean> {
        return this.trackedOps.has(userOpHash)
    }

    async findConflict(userOp: UserOperation): Promise<
        | {
              conflictingHash?: Hex
              reason?: "nonce_conflict" | "deployment_conflict"
          }
        | undefined
    > {
        const isDeploymentCheck = isDeployment(userOp)

        // Deployment conflict: if this is deployment AND sender already deploying
        if (isDeploymentCheck && this.deployingSenders.has(userOp.sender)) {
            return {
                conflictingHash: this.deployingSenders.get(userOp.sender),
                reason: "deployment_conflict"
            }
        }

        // Nonce conflict check
        const nonceId = `${userOp.sender}:${userOp.nonce}`

        if (this.senderNonces.has(nonceId)) {
            return {
                conflictingHash: this.senderNonces.get(nonceId),
                reason: "nonce_conflict"
            }
        }

        return undefined
    }

    async clear(): Promise<void> {
        this.trackedOps.clear()
        this.senderNonces.clear()
        this.deployingSenders.clear()
    }
}
