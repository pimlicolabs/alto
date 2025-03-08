import {
    getNonceKeyAndSequence,
    isVersion06,
    isVersion07
} from "../utils/userop"
import { AltoConfig } from "../createConfig"
import { HexData32, UserOpInfo, UserOperation } from "@alto/types"
import { ConflictingType, OutstandingStore } from "."

const senderNonceSlot = (userOp: UserOperation) => {
    const sender = userOp.sender
    const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
    return `${sender}-${nonceKey}`
}

const dump = (pendingOps: Map<string, UserOpInfo[]>) => {
    return [...Array.from(pendingOps.values()).flat()]
}

export const createMemoryOutstandingQueue = ({
    config
}: { config: AltoConfig }): OutstandingStore => {
    let pendingOps: Map<string, UserOpInfo[]> = new Map()
    let priorityQueue: UserOpInfo[] = []
    const logger = config.getLogger(
        { module: "memory-outstanding-queue" },
        {
            level: config.logLevel
        }
    )

    // Adds userOp to queue and maintains sorting by gas price.
    const addToPriorityQueue = ({
        priorityQueue,
        userOpInfo
    }: { userOpInfo: UserOpInfo; priorityQueue: UserOpInfo[] }) => {
        priorityQueue.push(userOpInfo)
        priorityQueue.sort((a, b) => {
            const userOpA = a.userOp
            const userOpB = b.userOp
            return Number(userOpA.maxFeePerGas - userOpB.maxFeePerGas)
        })
    }

    return {
        validateQueuedLimit: (userOp: UserOperation) => {
            const outstandingOps = dump(pendingOps)

            const parallelUserOperationsCount = outstandingOps.filter(
                (userOpInfo) => {
                    const { userOp: mempoolUserOp } = userOpInfo
                    return mempoolUserOp.sender === userOp.sender
                }
            ).length

            if (parallelUserOperationsCount > config.mempoolMaxParallelOps) {
                return false
            }

            return true
        },
        validateParallelLimit: (userOp: UserOperation) => {
            const outstandingOps = dump(pendingOps)

            const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
            const queuedUserOperationsCount = outstandingOps.filter(
                (userOpInfo) => {
                    const { userOp: mempoolUserOp } = userOpInfo
                    const [opNonceKey] = getNonceKeyAndSequence(
                        mempoolUserOp.nonce
                    )

                    return (
                        mempoolUserOp.sender === userOp.sender &&
                        opNonceKey === nonceKey
                    )
                }
            ).length

            if (queuedUserOperationsCount > config.mempoolMaxQueuedOps) {
                return false
            }

            return true
        },
        findConflicting: async (userOp: UserOperation) => {
            const outstandingOps = dump(pendingOps)

            let conflictingReason: ConflictingType = undefined

            for (const userOpInfo of outstandingOps) {
                const { userOp: mempoolUserOp } = userOpInfo

                const isSameSender = mempoolUserOp.sender === userOp.sender
                if (isSameSender && mempoolUserOp.nonce === userOp.nonce) {
                    conflictingReason = {
                        reason: "conflicting_nonce",
                        userOp: userOpInfo.userOp
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
                    conflictingReason = {
                        reason: "conflicting_deployment",
                        userOp: userOpInfo.userOp
                    }
                    break
                }
            }

            return conflictingReason
        },
        contains: async (userOpHash: HexData32) => {
            for (const userOpInfos of pendingOps.values()) {
                if (
                    userOpInfos.some((info) => info.userOpHash === userOpHash)
                ) {
                    return true
                }
            }
            return false
        },
        peek: () => {
            if (priorityQueue.length === 0) {
                return Promise.resolve(undefined)
            }

            return Promise.resolve(priorityQueue[0])
        },
        pop: () => {
            const userOpInfo = priorityQueue.shift()

            if (!userOpInfo) {
                return Promise.resolve(undefined)
            }

            const pendingOpsSlot = senderNonceSlot(userOpInfo.userOp)
            const backlogOps = pendingOps.get(pendingOpsSlot)

            // This should never throw.
            if (!backlogOps?.shift()) {
                throw new Error("FATAL: No pending userOps for sender")
            }

            // Move next pending userOp into priorityQueue if exist.
            if (backlogOps.length > 0) {
                addToPriorityQueue({ userOpInfo: backlogOps[0], priorityQueue })
            }

            // Cleanup.
            if (backlogOps.length === 0) {
                pendingOps.delete(pendingOpsSlot)
            }

            return Promise.resolve(userOpInfo)
        },
        add: (userOpInfo: UserOpInfo) => {
            const { userOp, userOpHash } = userOpInfo
            const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
            const pendingOpsSlot = senderNonceSlot(userOp)

            const backlogOps =
                pendingOps.get(pendingOpsSlot) ||
                pendingOps.set(pendingOpsSlot, []).get(pendingOpsSlot)!

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
                priorityQueue = priorityQueue.filter((userOpInfo) => {
                    const pendingUserOp = userOpInfo.userOp
                    const isSameSender = pendingUserOp.sender === userOp.sender
                    const isSameNonceKey =
                        getNonceKeyAndSequence(pendingUserOp.nonce)[0] ===
                        nonceKey

                    return !(isSameSender && isSameNonceKey)
                })

                addToPriorityQueue({ userOpInfo, priorityQueue })
            }

            return Promise.resolve()
        },
        remove: (userOpHash: HexData32) => {
            const priorityQueueIndex = priorityQueue.findIndex(
                (info) => info.userOpHash === userOpHash
            )

            if (priorityQueueIndex === -1) {
                logger.info("tried to remove non-existent user op from mempool")
                return Promise.resolve(false)
            }

            const userOpInfo = priorityQueue[priorityQueueIndex]
            const pendingOpsSlot = senderNonceSlot(userOpInfo.userOp)

            // Remove from priority queue
            priorityQueue.splice(priorityQueueIndex, 1)

            // Find and remove from pending ops
            const backlogOps = pendingOps.get(pendingOpsSlot)
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
                addToPriorityQueue({
                    userOpInfo: backlogOps[0],
                    priorityQueue
                })
            }

            return Promise.resolve(true)
        },
        dumpLocal: () => {
            return Promise.resolve(dump(pendingOps))
        },
        clear: () => {
            priorityQueue = []
            pendingOps.clear()
            return Promise.resolve()
        }
    }
}
