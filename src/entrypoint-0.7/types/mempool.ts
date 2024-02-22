import type { Address, Chain, Hex } from "viem"
import type { Account } from "viem/accounts"
import type {
    CompressedUserOperation,
    HexData32,
    UnPackedUserOperation
} from "./schemas"

export interface ReferencedCodeHashes {
    // addresses accessed during this user operation
    addresses: string[]

    // keccak over the code of all referenced addresses
    hash: string
}

export const deriveUserOperation = (
    op: MempoolUserOperation
): UnPackedUserOperation => {
    return isCompressedType(op)
        ? (op as CompressedUserOperation).inflatedOp
        : (op as UnPackedUserOperation)
}

export const isCompressedType = (op: MempoolUserOperation): boolean => {
    return "compressedCalldata" in op
}

export type MempoolUserOperation =
    | UnPackedUserOperation
    | CompressedUserOperation

export type TransactionInfo = {
    transactionType: "default" | "compressed"
    transactionHash: HexData32
    previousTransactionHashes: HexData32[]
    transactionRequest: {
        account: Account
        to: Address
        data: Hex
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
    mempoolUserOperation: MempoolUserOperation
    userOperationHash: HexData32
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

type Result<T, E, R> = Success<T> | Failure<E> | Resubmit<R>

interface Success<T> {
    status: "success"
    value: T
}

interface Failure<E> {
    status: "failure"
    error: E
}

interface Resubmit<R> {
    status: "resubmit"
    info: R
}

export type BundleResult = Result<
    { userOperation: UserOperationInfo; transactionInfo: TransactionInfo },
    { reason: string; userOpHash: HexData32 },
    {
        reason: string
        userOpHash: HexData32
        userOperation: MempoolUserOperation
    }
>
