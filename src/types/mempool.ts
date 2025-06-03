import type { HexData32, UserOpInfo } from "@alto/types"
import type { Address, BaseError, Prettify } from "viem"
import { EntryPointVersion } from "viem/_types/account-abstraction/types/entryPointVersion"
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
}

export type UserOperationBundle = {
    entryPoint: Address
    version: EntryPointVersion
    userOps: UserOpInfo[]
    submissionAttempts: number
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
          status: "submission_success"
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
          // Encountered unhandled error during filterOps simulation.
          status: "filterops_unhandled_error"
          rejectedUserOps: RejectedUserOp[]
      }
    | {
          // All user operations were rejected during filterOps simulation.
          status: "filterops_all_rejected"
          rejectedUserOps: RejectedUserOp[]
      }
    | {
          // Generic error during bundle submission.
          status: "submission_generic_error"
          reason: BaseError | "INTERNAL FAILURE"
          userOpsToBundle: UserOpInfo[]
          rejectedUserOps: RejectedUserOp[]
      }
    | {
          // Executor has insufficient funds for gas.
          status: "submission_insufficient_funds_error"
          userOpsToBundle: UserOpInfo[]
          rejectedUserOps: RejectedUserOp[]
      }
