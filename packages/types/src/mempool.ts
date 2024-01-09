import { Account } from "viem/accounts"
import { HexData32, UserOperation, CompressedUserOperation } from "."
import { Address, Chain, Hex } from "viem"

export interface ReferencedCodeHashes {
    // addresses accessed during this user operation
    addresses: string[]

    // keccak over the code of all referenced addresses
    hash: string
}

export const deriveUserOperation = (op: MempoolUserOperation): UserOperation => {
    return isCompressedType(op) ? (op as CompressedUserOperation).inflatedOp : (op as UserOperation)
}

export const isCompressedType = (op: MempoolUserOperation): boolean => {
    return "compressedCalldata" in op
}

export type MempoolUserOperation = UserOperation | CompressedUserOperation

export type TransactionInfo = {
    transactionType: "default" | "compressed"
    transactionHash: HexData32
    previousTransactionHashes: HexData32[]
    transactionRequest: {
        account: Account,
        address: Address,
        calldata: Hex,
        gas: bigint,
        chain: Chain,
        maxFeePerGas: bigint,
        maxPriorityFeePerGas: bigint,
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

type Result<T, E> = Success<T> | Failure<E>

interface Success<T> {
    success: true
    value: T
}

interface Failure<E> {
    success: false
    error: E
}

export type BundleResult = Result<
    { userOperation: UserOperationInfo; transactionInfo: TransactionInfo },
    { reason: string; userOpHash: HexData32 }
>
