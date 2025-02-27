import type { Address, BaseError } from "viem"
import type { Account } from "viem/accounts"
import {
    hexData32Schema,
    type HexData32,
    addressSchema,
    userOperationSchema
} from "."
import { z } from "zod"

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

export type RejectedUserOp = UserOpInfo & {
    reason: string
}

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

// Types used for internal mempool.
export const referencedCodeHashesSchema = z.object({
    addresses: z.array(z.string()),
    hash: z.string()
})

export const userOpDetailsSchema = z.object({
    userOpHash: hexData32Schema,
    entryPoint: addressSchema,
    // timestamp when the bundling process begins (when it leaves outstanding mempool)
    addedToMempool: z.number(),
    referencedContracts: referencedCodeHashesSchema.optional()
})

export const userOpInfoSchema = userOpDetailsSchema.extend({
    userOp: userOperationSchema
})

// Export types derived from schemas
export type ReferencedCodeHashes = z.infer<typeof referencedCodeHashesSchema>
export type UserOpDetails = z.infer<typeof userOpDetailsSchema>
export type UserOpInfo = z.infer<typeof userOpInfoSchema>
