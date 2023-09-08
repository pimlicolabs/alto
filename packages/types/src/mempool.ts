import { Account } from "viem/accounts"
import { HexData32, UserOperation } from "."
import { Abi, Chain, WriteContractParameters } from "viem"

export type TransactionInfo = {
    transactionHash: HexData32
    transactionRequest: WriteContractParameters<Abi | readonly unknown[], string, Chain, Account, Chain> & {
        nonce: number
        maxFeePerGas: bigint
        maxPriorityFeePerGas: bigint
        account: Account
    }
    executor: Account
    userOperationInfos: UserOperationInfo[]
    lastReplaced: number
    firstSubmitted: number
}

export type UserOperationInfo = {
    userOperation: UserOperation
    userOperationHash: HexData32
    lastReplaced: number
    firstSubmitted: number
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
