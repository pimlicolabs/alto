import { Address } from "viem"
import { getNonceKeyAndSequence, getUserOperationHash } from "../utils/userop"
import { AltoConfig } from "../createConfig"
import { UserOpInfo } from "../types/mempool"

const senderNonceSlot = ({
    sender,
    nonceKey
}: { sender: Address; nonceKey: bigint }) => {
    return `${sender}-${nonceKey}`
}

const addUserOp = ({
    userOpInfo,
    queue,
    pendingOps,
    chainId
}: {
    userOpInfo: UserOpInfo
    queue: UserOpInfo[]
    pendingOps: Map<string, UserOpInfo[]>
    chainId: number
}) => {
    const { userOp, userOpHash } = userOpInfo
    const [nonceKey, _nonceSeq] = getNonceKeyAndSequence(userOp.nonce)
    const pendingOpsSlot = senderNonceSlot({ sender: userOp.sender, nonceKey })

    // Get or create sender transaction record
    const senderOps =
        pendingOps.get(pendingOpsSlot) ||
        pendingOps.set(pendingOpsSlot, []).get(pendingOpsSlot)!

    // Sort sender ops by nonce
    senderOps
        .map((sop) => sop.userOp)
        .sort((a, b) => {
            const [, aNonceSeq] = getNonceKeyAndSequence(a.nonce)
            const [, bNonceSeq] = getNonceKeyAndSequence(b.nonce)
            return Number(aNonceSeq) - Number(bNonceSeq)
        })

    // Update gasQueue if this is the lowest nonce
    const lowestUserOpHash = getUserOperationHash(
        senderOps[0].userOp,
        senderOps[0].entryPoint,
        chainId
    )
    if (lowestUserOpHash === userOpHash) {
        // Remove any existing userOp with same sender and nonceKey
        queue = queue.filter((userOpInfo) => {
            const pendingUserOp = userOpInfo.userOp
            const isSameSender = pendingUserOp.sender === userOp.sender
            const isSameNonceKey =
                getNonceKeyAndSequence(pendingUserOp.nonce)[1] === nonceKey

            return !(isSameSender && isSameNonceKey)
        })

        // Add userOp to the priority queue and sort based on gas price
        queue.push(userOpInfo)

        // Sort priority queue by gas price (highest first)
        queue.sort((a, b) => {
            const userOpA = a.userOp
            const userOpB = b.userOp
            return Number(userOpA.maxFeePerGas - userOpB.maxFeePerGas)
        })
    }
}

const getNextUserOp = ({
    queue,
    pendingOps
}: {
    queue: UserOpInfo[]
    pendingOps: Map<string, UserOpInfo[]>
}) => {
    const userOpInfo = queue.shift()

    if (!userOpInfo) {
        return userOpInfo
    }

    const userOp = userOpInfo.userOp
    const [senderNonceKey] = getNonceKeyAndSequence(userOp.nonce)

    const pendingOpsSlot = senderNonceSlot({
        sender: userOp.sender,
        nonceKey: senderNonceKey
    })
    const senderOps = pendingOps.get(pendingOpsSlot)

    if (!senderOps) {
        // Should not happen.
        throw new Error("FATAL: No pending userOps for sender")
    }
    senderOps.shift() // Update pending ops by removing the lowest nonce

    // Move next pending transaction into gas queue
    if (senderOps.length > 0) {
        queue.push(senderOps[0])

        // Sort priority queue by gas price (highest first)
        queue.sort((a, b) => {
            const userOpA = a.userOp
            const userOpB = b.userOp
            return Number(userOpA.maxFeePerGas - userOpB.maxFeePerGas)
        })
    }

    // Cleanup
    if (senderOps.length === 0) {
        pendingOps.delete(pendingOpsSlot)
    }

    return userOpInfo
}

const createMemoryOutstandingQueue = ({ config }: { config: AltoConfig }) => {
    const pendingOps: Map<string, UserOpInfo[]> = new Map()
    const queue: UserOpInfo[] = []
    const chainId = config.chainId

    return {
        addUserOp: (userOpInfo: UserOpInfo) => {
            addUserOp({ userOpInfo, pendingOps, queue, chainId })
        },
        getNextUserOp: () => getNextUserOp({ queue, pendingOps })
    }
}
