import type { Address, Chain } from "viem"
import type { Account } from "viem/accounts"
import type { HexData32, UserOperation, UserOperation7702 } from "."

export interface ReferencedCodeHashes {
    // addresses accessed during this user operation
    addresses: string[]

    // keccak over the code of all referenced addresses
    hash: string
}

export const deriveUserOperation = (
    op: MempoolUserOperation
): UserOperation => {
    if (is7702Type(op)) {
        return (op as UserOperation7702).userOperation
    }

    return op as UserOperation
}

export const is7702Type = (
    op: MempoolUserOperation
): op is UserOperation7702 => {
    return "authorization" in op
}

export type MempoolUserOperation = UserOperation | UserOperation7702

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
    mempoolUserOperation: MempoolUserOperation
    entryPoint: Address
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
    {
        userOperation: UserOperationInfo
        transactionInfo: TransactionInfo
    },
    {
        reason: string
        userOpHash: HexData32
        entryPoint: Address
        userOperation: MempoolUserOperation
    },
    {
        reason: string
        userOpHash: HexData32
        entryPoint: Address
        userOperation: MempoolUserOperation
    }
>
