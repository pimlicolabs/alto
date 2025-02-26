import { getNonceKeyAndSequence, getUserOperationHash } from "../utils/userop"
import { AltoConfig } from "../createConfig"
import { UserOpInfo } from "../types/mempool"
import { HexData32, UserOperation } from "@alto/types"
import { Logger } from "@alto/utils"

const senderNonceSlot = (userOp: UserOperation) => {
    const sender = userOp.sender
    const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
    return `${sender}-${nonceKey}`
}

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

const add = ({
    userOpInfo,
    priorityQueue,
    pendingOps,
    chainId
}: {
    userOpInfo: UserOpInfo
    priorityQueue: UserOpInfo[]
    pendingOps: Map<string, UserOpInfo[]>
    chainId: number
}) => {
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

    const lowestUserOpHash = getUserOperationHash(
        backlogOps[0].userOp,
        backlogOps[0].entryPoint,
        chainId
    )

    // If lowest, remove any existing userOp with same sender and nonceKey and add current userOp to priorityQueue.
    if (lowestUserOpHash === userOpHash) {
        priorityQueue = priorityQueue.filter((userOpInfo) => {
            const pendingUserOp = userOpInfo.userOp
            const isSameSender = pendingUserOp.sender === userOp.sender
            const isSameNonceKey =
                getNonceKeyAndSequence(pendingUserOp.nonce)[1] === nonceKey

            return !(isSameSender && isSameNonceKey)
        })

        addToPriorityQueue({ userOpInfo, priorityQueue })
    }
}

const pop = ({
    priorityQueue,
    pendingOps
}: {
    priorityQueue: UserOpInfo[]
    pendingOps: Map<string, UserOpInfo[]>
}) => {
    const userOpInfo = priorityQueue.shift()

    if (!userOpInfo) {
        return undefined
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

    return userOpInfo
}

const remove = ({
    priorityQueue,
    pendingOps,
    userOpHash,
    logger
}: {
    priorityQueue: UserOpInfo[]
    pendingOps: Map<string, UserOpInfo[]>
    userOpHash: HexData32
    logger: Logger
}) => {
    const priorityQueueIndex = priorityQueue.findIndex(
        (info) => info.userOpHash === userOpHash
    )

    if (priorityQueueIndex === -1) {
        logger.info("tried to remove non-existent user op from mempool")
        return
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
}

const clear = ({
    pendingOps,
    priorityQueue
}: { pendingOps: Map<string, UserOpInfo[]>; priorityQueue: UserOpInfo[] }) => {
    priorityQueue = []
    pendingOps.clear()
}

const dump = ({
    priorityQueue,
    pendingOps
}: {
    priorityQueue: UserOpInfo[]
    pendingOps: Map<string, UserOpInfo[]>
}) => {
    return [...priorityQueue, ...Array.from(pendingOps.values()).flat()]
}

export const createMemoryOutstandingQueue = ({
    config
}: { config: AltoConfig }) => {
    const pendingOps: Map<string, UserOpInfo[]> = new Map()
    const priorityQueue: UserOpInfo[] = []
    const chainId = config.chainId
    const logger = config.getLogger(
        { module: "memory-outstanding-queue" },
        {
            level: config.logLevel
        }
    )

    return {
        add: (userOpInfo: UserOpInfo) =>
            add({ userOpInfo, pendingOps, priorityQueue, chainId }),
        remove: (userOpHash: HexData32) =>
            remove({ userOpHash, pendingOps, priorityQueue, logger }),
        pop: () => pop({ priorityQueue, pendingOps }),
        dump: () => dump({ priorityQueue, pendingOps }),
        clear: () => clear({ pendingOps, priorityQueue })
    }
}
