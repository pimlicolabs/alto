import type { HexData32, UserOpInfo, UserOperation } from "@alto/types"
import type { Logger } from "@alto/utils"
import type { AltoConfig } from "../../createConfig"
import {
    getNonceKeyAndSequence,
    isDeployment,
    isVersion07
} from "../../utils/userop"
import type { ConflictingOutstandingType, OutstandingStore } from "./types"

const senderNonceSlot = (userOp: UserOperation) => {
    const sender = userOp.sender
    const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
    return `${sender}-${nonceKey}`
}

export class MemoryOutstanding implements OutstandingStore {
    private readonly pendingOps: Map<string, UserOpInfo[]> = new Map()
    private readonly hashLookup: Map<HexData32, UserOpInfo> = new Map()
    private readonly logger: Logger
    private readonly config: AltoConfig
    private priorityQueue: UserOpInfo[] = []

    constructor(config: AltoConfig) {
        // Setup args for getting userOpHash
        this.config = config
        this.logger = config.getLogger(
            { module: "memory-outstanding-queue" },
            {
                level: config.logLevel
            }
        )
    }

    private dump(): UserOpInfo[] {
        return [...Array.from(this.pendingOps.values()).flat()]
    }

    // Adds userOp to queue and maintains sorting by gas price.
    private addToPriorityQueue(userOpInfo: UserOpInfo): void {
        this.priorityQueue.push(userOpInfo)
        this.priorityQueue.sort((a, b) => {
            const userOpA = a.userOp
            const userOpB = b.userOp
            return Number(userOpA.maxFeePerGas - userOpB.maxFeePerGas)
        })
    }

    validateQueuedLimit(userOp: UserOperation): boolean {
        const outstandingOps = this.dump()

        const parallelUserOpsCount = outstandingOps.filter((userOpInfo) => {
            const { userOp: mempoolUserOp } = userOpInfo
            return mempoolUserOp.sender === userOp.sender
        }).length

        if (parallelUserOpsCount > this.config.mempoolMaxQueuedOps) {
            return false
        }

        return true
    }

    validateParallelLimit(userOp: UserOperation): boolean {
        const outstandingOps = this.dump()

        const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
        const queuedUserOpsCount = outstandingOps.filter((userOpInfo) => {
            const { userOp: mempoolUserOp } = userOpInfo
            const [opNonceKey] = getNonceKeyAndSequence(mempoolUserOp.nonce)

            return (
                mempoolUserOp.sender === userOp.sender &&
                opNonceKey === nonceKey
            )
        }).length

        if (queuedUserOpsCount > this.config.mempoolMaxParallelOps) {
            return false
        }

        return true
    }

    async popConflicting(
        userOp: UserOperation
    ): Promise<ConflictingOutstandingType> {
        const outstandingOps = this.dump()

        let conflictingReason: ConflictingOutstandingType

        for (const userOpInfo of outstandingOps) {
            const { userOp: mempoolUserOp } = userOpInfo

            const isSameSender = mempoolUserOp.sender === userOp.sender
            if (isSameSender && mempoolUserOp.nonce === userOp.nonce) {
                const removed = await this.remove([userOpInfo.userOpHash])
                if (removed.length > 0) {
                    conflictingReason = {
                        reason: "conflicting_nonce",
                        userOpInfo: removed[0]
                    }
                }
                break
            }

            const isConflictingDeployment =
                isSameSender &&
                isDeployment(userOp) &&
                isDeployment(mempoolUserOp)

            if (isConflictingDeployment) {
                const removed = await this.remove([userOpInfo.userOpHash])
                if (removed.length > 0) {
                    conflictingReason = {
                        reason: "conflicting_deployment",
                        userOpInfo: removed[0]
                    }
                }
                break
            }
        }

        return conflictingReason
    }

    async contains(userOpHash: HexData32): Promise<boolean> {
        return this.hashLookup.has(userOpHash)
    }

    pop(count: number): Promise<UserOpInfo[]> {
        const results: UserOpInfo[] = []

        for (let i = 0; i < count; i++) {
            const userOpInfo = this.priorityQueue.shift()

            if (!userOpInfo) {
                break
            }

            const pendingOpsSlot = senderNonceSlot(userOpInfo.userOp)
            const backlogOps = this.pendingOps.get(pendingOpsSlot)

            // This should never throw.
            if (!backlogOps?.shift()) {
                throw new Error("FATAL: No pending userOps for sender")
            }

            // Move next pending userOp into priorityQueue if exist.
            if (backlogOps.length > 0) {
                this.addToPriorityQueue(backlogOps[0])
            } else {
                // Cleanup if no more ops for this slot
                this.pendingOps.delete(pendingOpsSlot)
            }

            // Remove from hash lookup
            this.hashLookup.delete(userOpInfo.userOpHash)

            results.push(userOpInfo)
        }

        return Promise.resolve(results)
    }

    async add(userOpInfos: UserOpInfo[]): Promise<void> {
        if (userOpInfos.length === 0) return

        for (const userOpInfo of userOpInfos) {
            const { userOp, userOpHash } = userOpInfo
            const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
            const pendingOpsSlot = senderNonceSlot(userOp)

            const backlogOps = (() => {
                if (this.pendingOps.has(pendingOpsSlot)) {
                    return this.pendingOps.get(pendingOpsSlot)
                }

                this.pendingOps.set(pendingOpsSlot, [])
                return this.pendingOps.get(pendingOpsSlot)
            })()

            if (!backlogOps) {
                throw new Error(
                    "FATAL: No pending operations found for userOpHash"
                )
            }

            // Note: the userOpInfo is always added to backlogOps, because we are pushing to a reference
            backlogOps.push(userOpInfo)

            // Add to hash lookup for O(1) contains checks
            this.hashLookup.set(userOpHash, userOpInfo)

            // Sort backlogOps by nonce sequence
            backlogOps.sort((a, b) => {
                const [, aNonceSeq] = getNonceKeyAndSequence(a.userOp.nonce)
                const [, bNonceSeq] = getNonceKeyAndSequence(b.userOp.nonce)
                return Number(aNonceSeq - bNonceSeq)
            })

            const lowestUserOpHash = backlogOps[0].userOpHash

            // If lowest, remove any existing userOp with same sender and nonceKey and add current userOp to priorityQueue.
            if (lowestUserOpHash === userOpHash) {
                this.priorityQueue = this.priorityQueue.filter((userOpInfo) => {
                    const pendingUserOp = userOpInfo.userOp
                    const isSameSender = pendingUserOp.sender === userOp.sender
                    const isSameNonceKey =
                        getNonceKeyAndSequence(pendingUserOp.nonce)[0] ===
                        nonceKey

                    return !(isSameSender && isSameNonceKey)
                })

                this.addToPriorityQueue(userOpInfo)
            }
        }
    }

    async getQueuedUserOps(userOp: UserOperation): Promise<UserOperation[]> {
        const [nonceKey, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)

        const outstandingOps = this.dump()
        const outstanding = outstandingOps.filter((userOpInfo) => {
            const { userOp: mempoolUserOp } = userOpInfo
            const [mempoolNonceKey, mempoolNonceSequence] =
                getNonceKeyAndSequence(mempoolUserOp.nonce)

            const isSameSender = mempoolUserOp.sender === userOp.sender
            const isSameNonceKey = mempoolNonceKey === nonceKey
            const isSameNonce = mempoolNonceSequence === nonceSequence

            // Skip the same userOp.
            if (isSameSender && isSameNonceKey && isSameNonce) {
                return false
            }

            // Include userOps from same sender with lower nonce.
            if (isSameSender && isSameNonceKey) {
                return mempoolNonceSequence < nonceSequence
            }

            // For v0.7+, include ops with same paymaster (unless ignored).
            if (isVersion07(userOp) && isVersion07(mempoolUserOp)) {
                const hasSamePaymaster =
                    userOp.paymaster !== null &&
                    mempoolUserOp.paymaster !== null &&
                    mempoolUserOp.paymaster === userOp.paymaster

                const isPaymasterIgnored =
                    userOp.paymaster !== null &&
                    this.config.ignoredPaymasters.includes(userOp.paymaster)

                return hasSamePaymaster && !isPaymasterIgnored
            }

            return false
        })

        return outstanding
            .sort((a, b) => {
                const aUserOp = a.userOp
                const bUserOp = b.userOp

                const [, aNonceValue] = getNonceKeyAndSequence(aUserOp.nonce)
                const [, bNonceValue] = getNonceKeyAndSequence(bUserOp.nonce)

                return Number(aNonceValue - bNonceValue)
            })
            .map((userOpInfo) => userOpInfo.userOp)
    }

    async remove(userOpHashes: HexData32[]): Promise<UserOpInfo[]> {
        if (userOpHashes.length === 0) {
            return []
        }

        const removedOps: UserOpInfo[] = []

        for (const userOpHash of userOpHashes) {
            // Look up userOp in hash lookup first
            const userOpInfo = this.hashLookup.get(userOpHash)

            if (!userOpInfo) {
                this.logger.info(
                    `tried to remove non-existent user op from mempool: ${userOpHash}`
                )
                continue
            }

            const pendingOpsSlot = senderNonceSlot(userOpInfo.userOp)

            // Find and remove from pending ops
            const backlogOps = this.pendingOps.get(pendingOpsSlot)
            if (!backlogOps) {
                throw new Error(
                    `FATAL: No pending operations found for userOpHash ${userOpHash}`
                )
            }

            const backlogIndex = backlogOps.findIndex(
                (info) => info.userOpHash === userOpHash
            )

            if (backlogIndex === -1) {
                throw new Error(
                    `FATAL: UserOp with hash ${userOpHash} not found in backlog`
                )
            }

            backlogOps.splice(backlogIndex, 1)

            // Remove from priority queue if present
            const priorityQueueIndex = this.priorityQueue.findIndex(
                (info) => info.userOpHash === userOpHash
            )
            if (priorityQueueIndex !== -1) {
                this.priorityQueue.splice(priorityQueueIndex, 1)
            }

            // Remove from hash lookup
            this.hashLookup.delete(userOpHash)

            // If this was the first operation and there are more in the backlog,
            // add the new first operation to the priority queue
            if (backlogIndex === 0 && backlogOps.length > 0) {
                this.addToPriorityQueue(backlogOps[0])
            }

            // Clean up empty slot
            if (backlogOps.length === 0) {
                this.pendingOps.delete(pendingOpsSlot)
            }

            removedOps.push(userOpInfo)
        }

        return removedOps
    }

    async dumpLocal(): Promise<UserOpInfo[]> {
        return this.dump()
    }

    async clear() {
        this.priorityQueue = []
        this.pendingOps.clear()
        this.hashLookup.clear()
    }
}

export const createMemoryOutstandingQueue = ({
    config,
    logger
}: {
    config: AltoConfig
    logger: Logger
}): OutstandingStore => {
    logger.info("Using memory for outstanding mempool")
    return new MemoryOutstanding(config)
}
