import type {
    HexData32,
    MempoolUserOperation,
    ReferencedCodeHashes,
    SubmittedUserOperation,
    TransactionInfo,
    UserOperation,
    UserOperationInfo
} from "@entrypoint-0.6/types"

export interface Mempool {
    add(
        op: MempoolUserOperation,
        referencedContracts?: ReferencedCodeHashes
    ): boolean
    checkEntityMultipleRoleViolation(_op: UserOperation): Promise<void>

    /**
     * Takes an array of user operations from the mempool, also marking them as submitted.
     *
     * @param gasLimit The maximum gas limit of user operations to take.
     * @param minOps The minimum number of user operations to take.
     * @returns An array of user operations to submit.
     */
    process(gasLimit: bigint, minOps?: number): Promise<MempoolUserOperation[]>

    replaceSubmitted(
        userOperation: UserOperationInfo,
        transactionInfo: TransactionInfo
    ): void

    markSubmitted(userOpHash: HexData32, transactionInfo: TransactionInfo): void

    /**
     * Removes a user operation from the mempool.
     *
     * @param userOpHash The hash of the user operation to remove.
     */
    removeSubmitted(userOpHash: HexData32): void
    removeProcessing(userOpHash: HexData32): void

    /**
     * Gets all user operation from the mempool.
     *
     * @returns An array of user operations.
     */
    dumpSubmittedOps(): SubmittedUserOperation[]

    dumpOutstanding(): UserOperationInfo[]

    dumpProcessing(): UserOperationInfo[]

    clear(): void
}
