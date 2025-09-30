import type { Address } from "abitype"
import type { HexData32, UserOpInfo, UserOperation } from "../types/schemas"
import type { ConflictingOutstandingType } from "./outstanding"

export type StoreType = "outstanding" | "processing"

export type ValidationResult =
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

export type EntryPointUserOpInfosParam = {
    entryPoint: Address
    userOpInfos: UserOpInfo[]
}

export type EntryPointUserOpHashParam = {
    entryPoint: Address
    userOpHash: HexData32
}

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export type MempoolStore = {
    // Methods used for bundling.
    popOutstanding: (
        entryPoint: Address,
        count: number
    ) => Promise<UserOpInfo[]>

    // Methods for state handling.
    addOutstanding: (args: EntryPointUserOpInfosParam) => Promise<void>
    removeOutstanding: (args: EntryPointUserOpHashParam) => Promise<void>
    dumpOutstanding: (entryPoint: Address) => Promise<UserOpInfo[]>

    // Conflict tracking (replaces processing/submitted pools).
    addProcessing: (args: EntryPointUserOpInfoParam) => Promise<void>
    removeProcessing: (args: EntryPointUserOpInfoParam) => Promise<void>

    // Methods for userOp validation before adding to mempool.
    checkDuplicatesAndConflicts: (args: {
        entryPoint: Address
        userOp: UserOperation
        userOpHash: HexData32
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
