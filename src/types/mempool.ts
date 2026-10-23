import type { HexData32, UserOpInfo } from "@alto/types"
import type { Address, Hex, Prettify, TransactionReceipt } from "viem"
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

// A bundle seen included but not yet reorg-confirmation-depth blocks deep.
// transactionHash/blockNumber/blockHash record where it was seen included.
// Holds no executor: its wallet was released at inclusion, so recovery
// resubmits through the mempool instead of re-broadcasting.
export type IncludedBundleInfo = {
    uid: string
    executor: Address
    userOpBundle: UserOperationBundle
    transactionHash: Hex
    blockNumber: bigint
    blockHash: Hex
}

export type RejectedUserOp = Prettify<
    UserOpInfo & {
        reason: string
    }
>

// How a bundle transaction was sent. Only eth_sendRawTransactionSync
// (EIP-7966) responds with the receipt: it resolves to the receipt, or to
// undefined when the node didn't return one, and never rejects.
export type BundleSend =
    | { method: "eth_sendRawTransaction" }
    | {
          method: "eth_sendRawTransactionSync"
          receipt: Promise<TransactionReceipt | undefined>
      }

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
          send: BundleSend
      }
    | {
          success: false
          reason:
              | "filterops_failed"
              | "filterops_unhandled_error"
              | "insufficient_funds"
              | "generic_error"
              | "nonce_conflict"
          rejectedUserOps: RejectedUserOp[]
          recoverableOps: UserOpInfo[]
      }
