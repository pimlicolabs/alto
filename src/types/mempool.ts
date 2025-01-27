import type { Address, BaseError, Hex } from "viem"
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
    firstSubmitted: number
    timesPotentiallyIncluded: number
}

export type UserOperationBundle = {
    entryPoint: Address
    version: "0.6" | "0.7"
    userOperations: UserOperationInfo[]
}

export type UserOperationInfo = UserOperation & {
    hash: Hex
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
    userOperation: UserOperationInfo
    reason: string
}

export type BundleResult =
    | {
          // Successfully sent bundle.
          status: "bundle_success"
          userOpsBundled: UserOperationInfo[]
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
          userOps: UserOperationInfo[]
      }
    | {
          // All user operations failed during simulation.
          status: "all_ops_failed_simulation"
          rejectedUserOps: RejectedUserOperation[]
      }
    | {
          // Encountered error whilst trying to send bundle.
          status: "bundle_submission_failure"
          reason: BaseError | "INTERNAL FAILURE"
          userOps: UserOperationInfo[]
      }
