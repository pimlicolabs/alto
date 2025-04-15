import {
    getNonceKeyAndSequence,
    isVersion06,
    isVersion07
} from "../utils/userop"
import { AltoConfig } from "../createConfig"
import { HexData32, UserOpInfo, UserOperation } from "@alto/types"
import { ConflictingOutstandingType, OutstandingStore } from "."
import { Logger } from "@alto/utils"

const senderNonceSlot = (userOp: UserOperation) => {
    const sender = userOp.sender
    const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
    return `${sender}-${nonceKey}`
}

export class MemoryOutstanding implements OutstandingStore {
    private pendingOps: Map<string, UserOpInfo[]> = new Map()
    private priorityQueue: UserOpInfo[] = []
    private logger: Logger

    constructor(private config: AltoConfig) {
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

        const parallelUserOperationsCount = outstandingOps.filter(
            (userOpInfo) => {
                const { userOp: mempoolUserOp } = userOpInfo
                return mempoolUserOp.sender === userOp.sender
            }
        ).length

        if (parallelUserOperationsCount > this.config.mempoolMaxParallelOps) {
            return false
        }

        return true
    }

    validateParallelLimit(userOp: UserOperation): boolean {
        const outstandingOps = this.dump()

        const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
        const queuedUserOperationsCount = outstandingOps.filter(
            (userOpInfo) => {
                const { userOp: mempoolUserOp } = userOpInfo
                const [opNonceKey] = getNonceKeyAndSequence(mempoolUserOp.nonce)

                return (
                    mempoolUserOp.sender === userOp.sender &&
                    opNonceKey === nonceKey
                )
            }
        ).length

        if (queuedUserOperationsCount > this.config.mempoolMaxQueuedOps) {
            return false
        }

        return true
    }

    async popConflicting(
        userOp: UserOperation
    ): Promise<ConflictingOutstandingType> {
        const outstandingOps = this.dump()

        let conflictingReason: ConflictingOutstandingType = undefined

        for (const userOpInfo of outstandingOps) {
            const { userOp: mempoolUserOp } = userOpInfo

            const isSameSender = mempoolUserOp.sender === userOp.sender
            if (isSameSender && mempoolUserOp.nonce === userOp.nonce) {
                this.remove(userOpInfo.userOpHash)
                conflictingReason = {
                    reason: "conflicting_nonce",
                    userOpInfo
                }
                break
            }

            const isConflictingV6Deployment =
                isVersion06(userOp) &&
                isVersion06(mempoolUserOp) &&
                userOp.initCode &&
                userOp.initCode !== "0x" &&
                mempoolUserOp.initCode &&
                mempoolUserOp.initCode !== "0x" &&
                isSameSender

            const isConflictingV7Deployment =
                isVersion07(userOp) &&
                isVersion07(mempoolUserOp) &&
                userOp.factory &&
                userOp.factory !== "0x" &&
                mempoolUserOp.factory &&
                mempoolUserOp.factory !== "0x" &&
                isSameSender

            const isConflictingDeployment =
                isConflictingV6Deployment || isConflictingV7Deployment

            if (isConflictingDeployment) {
                this.remove(userOpInfo.userOpHash)
                conflictingReason = {
                    reason: "conflicting_deployment",
                    userOpInfo
                }
                break
            }
        }

        return conflictingReason
    }

    async contains(userOpHash: HexData32): Promise<boolean> {
        for (const userOpInfos of this.pendingOps.values()) {
            if (userOpInfos.some((info) => info.userOpHash === userOpHash)) {
                return true
            }
        }
        return false
    }

    async peek(): Promise<UserOpInfo | undefined> {
        if (this.priorityQueue.length === 0) {
            return undefined
        }

        return this.priorityQueue[0]
    }

    async pop(): Promise<UserOpInfo | undefined> {
        const userOpInfo = this.priorityQueue.shift()

        if (!userOpInfo) {
            return undefined
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
        }

        // Cleanup.
        if (backlogOps.length === 0) {
            this.pendingOps.delete(pendingOpsSlot)
        }

        return userOpInfo
    }

    async add(userOpInfo: UserOpInfo): Promise<void> {
        const { userOp, userOpHash } = userOpInfo
        const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
        const pendingOpsSlot = senderNonceSlot(userOp)

        const backlogOps =
            this.pendingOps.get(pendingOpsSlot) ||
            this.pendingOps.set(pendingOpsSlot, []).get(pendingOpsSlot)!

        // Note: the userOpInfo is always added to backlogOps, because we are pushing to a reference
        backlogOps.push(userOpInfo)

        backlogOps
            .map((sop) => sop.userOp)
            .sort((a, b) => {
                const [, aNonceSeq] = getNonceKeyAndSequence(a.nonce)
                const [, bNonceSeq] = getNonceKeyAndSequence(b.nonce)
                return Number(aNonceSeq) - Number(bNonceSeq)
            })

        const lowestUserOpHash = backlogOps[0].userOpHash

        // If lowest, remove any existing userOp with same sender and nonceKey and add current userOp to priorityQueue.
        if (lowestUserOpHash === userOpHash) {
            this.priorityQueue = this.priorityQueue.filter((userOpInfo) => {
                const pendingUserOp = userOpInfo.userOp
                const isSameSender = pendingUserOp.sender === userOp.sender
                const isSameNonceKey =
                    getNonceKeyAndSequence(pendingUserOp.nonce)[0] === nonceKey

                return !(isSameSender && isSameNonceKey)
            })

            this.addToPriorityQueue(userOpInfo)
        }
    }

    async getQueuedUserOps(userOp: UserOperation): Promise<UserOperation[]> {
        const [nonceKey, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)

        const outstandingOps = this.dump()
        const outstanding = outstandingOps.filter((userOpInfo) => {
            const { userOp: mempoolUserOp } = userOpInfo

            const [mempoolNonceKey, mempoolNonceSequence] =
                getNonceKeyAndSequence(mempoolUserOp.nonce)

            let isPaymasterSame = false

            if (isVersion07(userOp) && isVersion07(mempoolUserOp)) {
                isPaymasterSame =
                    mempoolUserOp.paymaster === userOp.paymaster &&
                    !(
                        mempoolUserOp.sender === userOp.sender &&
                        mempoolNonceKey === nonceKey &&
                        mempoolNonceSequence === nonceSequence
                    ) &&
                    userOp.paymaster !== null
            }

            // Filter operations with the same sender and nonce key
            // but with a lower nonce sequence
            return (
                (mempoolUserOp.sender === userOp.sender &&
                    mempoolNonceKey === nonceKey &&
                    mempoolNonceSequence < nonceSequence) ||
                isPaymasterSame
            )
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

    async remove(userOpHash: HexData32): Promise<boolean> {
        const priorityQueueIndex = this.priorityQueue.findIndex(
            (info) => info.userOpHash === userOpHash
        )

        if (priorityQueueIndex === -1) {
            this.logger.info(
                "tried to remove non-existent user op from mempool"
            )
            return false
        }

        const userOpInfo = this.priorityQueue[priorityQueueIndex]
        const pendingOpsSlot = senderNonceSlot(userOpInfo.userOp)

        // Remove from priority queue
        this.priorityQueue.splice(priorityQueueIndex, 1)

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

        // If this was the first operation and there are more in the backlog,
        // add the new first operation to the priority queue
        if (backlogIndex === 0 && backlogOps.length > 0) {
            this.addToPriorityQueue(backlogOps[0])
        }

        return true
    }

    async dumpLocal(): Promise<UserOpInfo[]> {
        return this.dump()
    }

    async clear(): Promise<void> {
        this.priorityQueue = []
        this.pendingOps.clear()
    }

    // Adding findConflicting method to maintain compatibility with Store interface
    async findConflicting(
        userOp: UserOperation
    ): Promise<ConflictingOutstandingType> {
        return this.popConflicting(userOp)
    }
}

export const createMemoryOutstandingQueue = ({
    config
}: { config: AltoConfig }): OutstandingStore => {
    return new MemoryOutstanding(config)
}
