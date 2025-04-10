import type { HexData32, UserOpInfo } from "@alto/types"
import type { Address, BaseError, Prettify } from "viem"
import type { Account } from "viem/accounts"

export type TransactionInfo = {
    transactionHash: HexData32
    previousTransactionHashes: HexData32[]
    transactionRequest: {
        gas: bigint
        maxFeePerGas: bigint
        maxPriorityFeePerGas: bigint
        nonce: number
    }
    bundle: UserOperationBundle
    executor: Account
    lastReplaced: number
    timesPotentiallyIncluded: number
    submissionAttempts: number
}

export type UserOperationBundle = {
    entryPoint: Address
    version: "0.6" | "0.7"
    userOps: UserOpInfo[]
}

export enum SubmissionStatus {
    NotSubmitted = "not_submitted",
    Rejected = "rejected",
    Submitted = "submitted",
    Included = "included"
}

export type SubmittedUserOp = UserOpInfo & {
    transactionInfo: TransactionInfo
}

export type RejectedUserOp = Prettify<
    UserOpInfo & {
        reason: string
    }
>

export type BundleResult =
    | {
          // Successfully sent bundle.
          status: "bundle_success"
          userOpsBundled: UserOpInfo[]
          rejectedUserOps: RejectedUserOp[]
          transactionHash: HexData32
          transactionRequest: {
              gas: bigint
              maxFeePerGas: bigint
              maxPriorityFeePerGas: bigint
              nonce: number
          }
      }
    | {
          // Encountered unhandled error during bundle simulation.
          status: "unhandled_simulation_failure"
          rejectedUserOps: RejectedUserOp[]
          reason: string
      }
    | {
          // All user operations failed during simulation.
          status: "all_ops_failed_simulation"
          rejectedUserOps: RejectedUserOp[]
      }
    | {
          // Encountered error whilst trying to send bundle.
          status: "bundle_submission_failure"
          reason: BaseError | "INTERNAL FAILURE"
          userOpsToBundle: UserOpInfo[]
          rejectedUserOps: RejectedUserOp[]
      }
