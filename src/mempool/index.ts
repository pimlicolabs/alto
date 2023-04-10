import { UserOp } from "../userOp"

export interface MempoolEntry {
    entrypoint: string
    userOp: UserOp
    transactionHash: string
    included: boolean
}

export abstract class Mempool {
    abstract currentSize(): number
    abstract add(entrypoint: string, userOp: UserOp): string // return hash of userOp
    abstract remove(opHashes: string[]): void
    abstract get(hash: string): MempoolEntry
    abstract getAll(): MempoolEntry[]
    abstract clear(): void
    abstract getUserOpHash(op: UserOp): string
}
