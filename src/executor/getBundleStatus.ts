import type { UserOperationReceipt } from "@alto/types"
import type { Logger } from "pino"
import type { Hex, PublicClient, TransactionReceipt } from "viem"
import type { SubmittedBundleInfo, UserOperationBundle } from "../types/mempool"
import { parseUserOpReceipt } from "../utils/userop"

export type BundleIncluded = {
    status: "included"
    userOpReceipts: Record<Hex, UserOperationReceipt>
    transactionHash: Hex
    blockNumber: bigint
    blockHash: Hex
}

export type BundleReverted = {
    status: "reverted"
    blockNumber: bigint
    transactionHash: Hex
}

export type BundleNotFound = {
    status: "not_found"
}

export type BundleInternalError = {
    status: "internal_error"
    error: string
}

export type BundleStatus<
    status extends "included" | "reverted" | "not_found" | "internal_error" =
        | "included"
        | "reverted"
        | "not_found"
        | "internal_error"
> =
    | (status extends "included" ? BundleIncluded : never)
    | (status extends "reverted" ? BundleReverted : never)
    | (status extends "not_found" ? BundleNotFound : never)
    | (status extends "internal_error" ? BundleInternalError : never)

// Return the status of the bundling transaction.
export const getBundleStatus = async ({
    publicClient,
    submittedBundle
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
    const reverted = receipts.find((receipt) => receipt?.status === "reverted")
    const receipt = included ?? reverted

    if (receipt) {
        return getBundleStatusFromReceipt({ bundle, receipt })
    }

    // If none of the receipts are included or reverted, return not_found.
    return { status: "not_found" }
}

// Return the status of a bundle from the receipt of one of its transactions.
export const getBundleStatusFromReceipt = ({
    bundle,
    receipt
}: {
    bundle: UserOperationBundle
    receipt: TransactionReceipt
}): BundleStatus<"included" | "reverted"> => {
    const { blockNumber, blockHash, transactionHash } = receipt

    if (receipt.status === "reverted") {
        return {
            status: "reverted",
            blockNumber,
            transactionHash
        }
    }

    const userOpReceipts: Record<Hex, UserOperationReceipt> = {}
    for (const { userOpHash } of bundle.userOps) {
        userOpReceipts[userOpHash] = parseUserOpReceipt(userOpHash, receipt)
    }

    return {
        status: "included",
        userOpReceipts,
        transactionHash,
        blockNumber,
        blockHash
    }
}
