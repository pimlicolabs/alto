import type {
    MempoolUserOperation,
    ReferencedCodeHashes,
    SubmittedUserOperation,
    TransactionInfo,
    UnPackedUserOperation,
    UserOperationInfo
} from "@entrypoint-0.7/types"
import type { Mempool } from "./types"

export class NullMempool implements Mempool {
    clear(): void {
        throw new Error("Method not implemented.")
    }
    dumpOutstanding(): UserOperationInfo[] {
        throw new Error("Method not implemented.")
    }
    removeProcessing(_: `0x${string}`): void {
        throw new Error("Method not implemented.")
    }
    replaceSubmitted(_: UserOperationInfo, __: TransactionInfo): void {
        throw new Error("Method not implemented.")
    }
    markSubmitted(_: `0x${string}`, __: TransactionInfo): void {
        throw new Error("Method not implemented.")
    }
    dumpSubmittedOps(): SubmittedUserOperation[] {
        throw new Error("Method not implemented.")
    }
    dumpProcessing(): UserOperationInfo[] {
        throw new Error("Method not implemented.")
    }
    removeSubmitted(_: `0x${string}`): void {
        throw new Error("Method not implemented.")
    }
    add(
        _op: MempoolUserOperation,
        _referencedContracts?: ReferencedCodeHashes
    ): boolean {
        return false
    }
    checkEntityMultipleRoleViolation(
        _op: UnPackedUserOperation
    ): Promise<void> {
        return Promise.resolve()
    }

    process(_: bigint, __?: number): Promise<MempoolUserOperation[]> {
        return Promise.resolve([])
    }
}
