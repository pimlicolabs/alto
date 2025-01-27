import type { Address, BaseError } from "viem"
import type { Account } from "viem/accounts"
import type { HexData32, UserOperation } from "."

export interface ReferencedCodeHashes {
    // addresses accessed during this user operation
    addresses: string[]

    // keccak over the code of all referenced addresses
    hash: string
}

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
    version: "0.6" | "0.7"
    userOperations: UserOperation[]
}

export type UserOperationInfo = {
    userOperation: UserOperation
    userOperationHash: HexData32
    entryPoint: Address
    referencedContracts?: ReferencedCodeHashes
}

export enum SubmissionStatus {
    NotSubmitted = "not_submitted",
    Rejected = "rejected",
    Submitted = "submitted",
    Included = "included"
}

export type SubmittedUserOperation = {
    userOperation: UserOperationInfo
    transactionInfo: TransactionInfo
}

export type RejectedUserOperation = {
    userOperation: UserOperation
    reason: string
}

export type BundleResult =
    | {
          // Successfully bundled user operations.
          status: "bundle_success"
          userOpsBundled: UserOperation[]
          rejectedUserOperations: RejectedUserOperation[]
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
          reason: string
          userOps: UserOperation[]
      }
    | {
          // All user operations failed simulation.
          status: "all_ops_failed_simulation"
          rejectedUserOps: RejectedUserOperation[]
      }
    | {
          // Encountered error whilst trying to bundle user operations.
          status: "bundle_submission_failure"
          reason: BaseError | "INTERNAL FAILURE"
          userOps: UserOperation[]
      }

export type BundleRequest = {}
