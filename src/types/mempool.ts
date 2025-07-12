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

export type UserOperationBundle = {
    entryPoint: Address
    version: EntryPointVersion
    userOps: UserOpInfo[]
    submissionAttempts: number
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
