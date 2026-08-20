import type { HexData32, UserOpInfo } from "@alto/types"
import type { Address, Prettify } from "viem"
import type { EntryPointVersion } from "viem/account-abstraction"
import type { Account } from "viem/accounts"

export type SubmittedBundleInfo = {
    uid: string
    transactionHash: HexData32
    previousTransactionHashes: HexData32[]
    transactionRequest: {
        maxFeePerGas: bigint
        maxPriorityFeePerGas: bigint
        nonce: number
    }
    bundle: UserOperationBundle
    executor: Account
    lastReplaced: number
}

// Serializable version of SubmittedBundleInfo for persistence to Redis/queue
// Account objects cannot be JSON serialized because they lose their methods
// during the serialization/deserialization process.
// We store only the executor address and reconstruct the full Account during restoration.
export type SerializableSubmittedBundleInfo = Omit<
    SubmittedBundleInfo,
    "executor"
> & {
    executorAddress: Address
}

export type UserOperationBundle = {
    entryPoint: Address
    version: EntryPointVersion
    userOps: UserOpInfo[]
    submissionAttempts: number
}

// Where a bundle was seen included on chain. blockHash detects reorgs: a
// block number can be reused across forks, a hash cannot.
export type InclusionAnchor = {
    transactionHash: HexData32
    blockNumber: bigint
    blockHash: HexData32
}

// A bundle seen included on chain but not yet reorg-confirmation-depth
// blocks deep. Deliberately holds no executor or transaction request: the
// wallet and the mempool processing claim were already released at
// inclusion, so recovery after a reorg goes through mempool.resubmitUserOps
// (fresh bundle, wallet and nonce), never by re-broadcasting the original
// transaction.
export type IncludedBundleInfo = {
    uid: string
    transactionHash: HexData32
    previousTransactionHashes: HexData32[]
    bundle: UserOperationBundle
    includedAt: InclusionAnchor
}

export type RejectedUserOp = Prettify<
    UserOpInfo & {
        reason: string
    }
>

export type BundleResult =
    | {
          success: true
          transactionHash: HexData32
          transactionRequest: {
              maxFeePerGas: bigint
              maxPriorityFeePerGas: bigint
              nonce: number
          }
          userOpsBundled: UserOpInfo[]
          rejectedUserOps: RejectedUserOp[]
      }
    | {
          success: false
          reason: "filterops_failed" | "insufficient_funds" | "generic_error"
          rejectedUserOps: RejectedUserOp[]
          recoverableOps: UserOpInfo[]
      }
