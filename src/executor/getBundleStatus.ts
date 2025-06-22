import { Logger } from "pino"
import { Hex, PublicClient } from "viem"
import { SubmittedBundleInfo } from "../types/mempool"
import { UserOperationReceipt } from "@alto/types"
import { parseUserOperationReceipt } from "../utils/userop"

export type BundleIncluded = {
    status: "included"
    userOpReceipts: Record<Hex, UserOperationReceipt>
    transactionHash: Hex
    blockNumber: bigint
}

export type BundleReverted = {
    status: "reverted"
    blockNumber: bigint
    transactionHash: Hex
}

export type BundleNotFound = {
    status: "not_found"
}

export type BundleStatus = BundleIncluded | BundleReverted | BundleNotFound

// Return the status of the bundling transaction.
export const getBundleStatus = async ({
    publicClient,
    submittedBundle,
    logger
}: {
    submittedBundle: SubmittedBundleInfo
    publicClient: PublicClient
    logger: Logger
}): Promise<BundleStatus> => {
    const {
        transactionHash: currentHash,
        previousTransactionHashes: previousHashes,
        bundle
    } = submittedBundle

    const receipts = await Promise.all(
        [currentHash, ...previousHashes].map((hash) =>
            publicClient.getTransactionReceipt({ hash }).catch(() => undefined)
        )
    )

    const included = receipts.find((receipt) => receipt?.status === "success")

    // If any of the txs are included.
    if (included) {
        const { userOps } = bundle
        const { blockNumber, transactionHash } = included
        const userOpDetails: Record<Hex, UserOperationReceipt> = {}

        for (const { userOpHash } of userOps) {
            userOpDetails[userOpHash] = parseUserOperationReceipt(
                userOpHash,
                included
            )
        }

        return {
            status: "included",
            userOpReceipts: userOpDetails,
            transactionHash,
            blockNumber
        }
    }

    const reverted = receipts.find((receipt) => receipt?.status === "reverted")

    // If any of the txs reverted.
    if (reverted) {
        const { blockNumber, transactionHash } = reverted
        return {
            status: "reverted",
            blockNumber,
            transactionHash
        }
    }

    // If none of the receipts are included or reverted, return not_found.
    return { status: "not_found" }
}
