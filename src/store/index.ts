import type { Address, HexData32, UserOpInfo, UserOperation } from "@alto/types"
import { ConflictingOutstandingType } from "./outstanding"

// Define the StoreType type
export type StoreType = "outstanding" | "processing" | "submitted"

export type ConflictingStoreType =
    | {
          reason: "conflicting_nonce" | "conflicting_deployment"
          userOp: UserOperation
      }
    | undefined

type ValidationResult =
    | {
          valid: true
      }
    | {
          valid: false
          reason: string
      }

export type EntryPointUserOpInfoParam = {
    entryPoint: Address
    userOpInfo: UserOpInfo
}

export type EntryPointUserOpHashParam = {
    entryPoint: Address
    userOpHash: HexData32
}

export type EntryPointUserOpParam = {
    userOp: UserOperation
    entryPoint: Address
}

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export type MempoolStore = {
    // Methods used to get next best userOp.
    popOutstanding: (entryPoint: Address) => Promise<UserOpInfo | undefined>

    // Methods for handling outstanding userOps.
    addOutstanding: (args: EntryPointUserOpInfoParam) => Promise<void>
    removeOutstanding: (args: EntryPointUserOpHashParam) => Promise<void>

    // Methods for marking userOp as included.

    dumpOutstanding: (entryPoint: Address) => Promise<UserOpInfo[]>
    dumpProcessing: (entryPoint: Address) => Promise<UserOpInfo[]>
    dumpSubmitted: (entryPoint: Address) => Promise<UserOpInfo[]>

    // Methods for userOp validation before adding to mempool.
    checkMempoolConflicts: (args: {
        userOpHash: HexData32
        entryPoint: Address
        userOp: UserOperation
    }) => Promise<ValidationResult>
    popConflictingOustanding: (args: {
        entryPoint: Address
        userOp: UserOperation
    }) => Promise<ConflictingOutstandingType>
    validateSenderLimits: (args: {
        entryPoint: Address
        userOp: UserOperation
    }) => Promise<ValidationResult>

    // Misc.
    getQueuedOutstandingUserOps: (args: {
        userOp: UserOperation
        entryPoint: Address
    }) => Promise<UserOperation[]>
    clearOutstanding: (entryPoint: Address) => Promise<void>
}

export { createMempoolStore } from "./createMempoolStore"
