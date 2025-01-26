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
        account: Account
        to: Address
        gas: bigint
        chain: Chain
        maxFeePerGas: bigint
        maxPriorityFeePerGas: bigint
        nonce: number
    }
    executor: Account
    userOperationInfos: UserOperationInfo[]
    lastReplaced: number
    firstSubmitted: number
    timesPotentiallyIncluded: number
}

export type UserOperationInfo = {
    userOperation: UserOperation
    userOperationHash: HexData32
    entryPoint: Address
    lastReplaced: number
    firstSubmitted: number
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

export type BundleResult =
    | {
          status: "success"
          userOperations: UserOperation[]
          rejectedUserOperations: UserOperation[]
          transactionInfo: TransactionInfo
      }
    | {
          status: "failure"
          reason: string
          userOperations: UserOperation[]
      }
    | {
          status: "resubmit"
          reason: string
          userOperations: UserOperation[]
      }
