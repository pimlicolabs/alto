import type { Address, Chain } from "viem"
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
    entryPoint: Address
    isVersion06: boolean
    transactionRequest: {
        gas: bigint
        chain: Chain
        maxFeePerGas: bigint
        maxPriorityFeePerGas: bigint
        nonce: number
    }
    executor: Account
    userOperationInfos: UserOperationInfo[]
    lastReplaced: number
    timesPotentiallyIncluded: number
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
          transactionInfo: TransactionInfo
      }
    | {
          // Encountered error whilst trying to bundle user operations.
          status: "bundle_failure"
          reason: string
          userOps: UserOperation[]
      }
    | {
          // Encountered recoverable error whilst trying to bundle user operations.
          status: "bundle_resubmit"
          reason: string
          userOps: UserOperation[]
      }

export type BundleRequest = {}
