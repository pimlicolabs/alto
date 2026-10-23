import type { BundleResult, SubmittedBundleInfo } from "@alto/types"
import type { Hex } from "viem"

// Rules for the executor nonce tracked by the sender manager. A tracked nonce
// is only ever set from a mined bundle transaction, and is forgotten whenever
// the executor may have used a nonce we can't account for, so the next bundle
// reads it from the chain instead.

// Whether a bundle attempt sent (or may have sent) a transaction, moving the
// executor's nonce. Only the filterOps simulation failures return before
// anything is sent.
export const sentTransaction = (bundleResult: BundleResult): boolean => {
    if (bundleResult.success) {
        return true
    }
    return (
        bundleResult.reason !== "filterops_failed" &&
        bundleResult.reason !== "filterops_unhandled_error"
    )
}

// The executor's next nonce once one of a bundle's transactions was mined,
// or undefined when it isn't known for sure. Only the latest transaction's
// nonce is kept, and earlier ones can differ from it when a replacement
// retried with another nonce.
export const getNextNonceAfterMinedBundle = ({
    submittedBundle,
    minedTransactionHash
}: {
    submittedBundle: Pick<
        SubmittedBundleInfo,
        "transactionHash" | "transactionRequest"
    >
    minedTransactionHash: Hex
}): number | undefined => {
    const { transactionHash, transactionRequest } = submittedBundle
    if (minedTransactionHash.toLowerCase() !== transactionHash.toLowerCase()) {
        return undefined
    }
    return transactionRequest.nonce + 1
}
