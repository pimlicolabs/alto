// import { MongoClient, Collection, Filter } from "mongodb"
// import { PublicClient, getContract } from "viem"
// import { EntryPointAbi } from "../types/EntryPoint"
import { SubmittedUserOperation, TransactionInfo, UserOperation, UserOperationInfo } from "@alto/types"
import { HexData32 } from "@alto/types"
import { Monitor } from "./monitoring"
import { Address, Chain, PublicClient, Transport } from "viem"
import { Logger, Metrics, getUserOperationHash } from "@alto/utils"
import { MemoryStore } from "./store"

export interface Mempool {
    add(op: UserOperation): void

    /**
     * Takes an array of user operations from the mempool, also marking them as submitted.
     *
     * @param gasLimit The maximum gas limit of user operations to take.
     * @param minOps The minimum number of user operations to take.
     * @returns An array of user operations to submit.
     */
    process(gasLimit?: bigint, minOps?: number): UserOperation[]

    replaceSubmitted(userOperation: UserOperationInfo, transactionInfo: TransactionInfo): void

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
}

export class NullMempool implements Mempool {
    removeProcessing(userOpHash: `0x${string}`): void {
        throw new Error("Method not implemented.")
    }
    replaceSubmitted(userOperation: UserOperationInfo, transactionInfo: TransactionInfo): void {
        throw new Error("Method not implemented.")
    }
    markSubmitted(userOpHash: `0x${string}`, transactionInfo: TransactionInfo): void {
        throw new Error("Method not implemented.")
    }
    dumpSubmittedOps(): SubmittedUserOperation[] {
        throw new Error("Method not implemented.")
    }
    removeSubmitted(userOpHash: `0x${string}`): void {
        throw new Error("Method not implemented.")
    }
    add(_op: UserOperation) {}

    process(_gasLimit?: bigint, minOps?: number): UserOperation[] {
        return []
    }
}

export class MemoryMempool implements Mempool {
    private monitor: Monitor
    private publicClient: PublicClient<Transport, Chain>
    private entryPointAddress: Address
    private store: MemoryStore

    constructor(
        monitor: Monitor,
        publicClient: PublicClient<Transport, Chain>,
        entryPointAddress: Address,
        logger: Logger,
        metrics: Metrics
    ) {
        this.monitor = monitor
        this.publicClient = publicClient
        this.entryPointAddress = entryPointAddress
        this.store = new MemoryStore(logger, metrics)
    }

    replaceSubmitted(userOperation: UserOperationInfo, transactionInfo: TransactionInfo): void {
        const op = this.store
            .dumpSubmitted()
            .find((op) => op.userOperation.userOperationHash === userOperation.userOperationHash)
        if (op) {
            this.store.removeSubmitted(userOperation.userOperationHash)
            this.store.addSubmitted({
                userOperation,
                transactionInfo
            })
            this.monitor.setUserOperationStatus(userOperation.userOperationHash, {
                status: "submitted",
                transactionHash: transactionInfo.transactionHash
            })
        }
    }

    markSubmitted(userOpHash: `0x${string}`, transactionInfo: TransactionInfo): void {
        const op = this.store.dumpProcessing().find((op) => op.userOperationHash === userOpHash)
        if (op) {
            this.store.removeProcessing(userOpHash)
            this.store.addSubmitted({
                userOperation: op,
                transactionInfo
            })
            this.monitor.setUserOperationStatus(userOpHash, {
                status: "submitted",
                transactionHash: transactionInfo.transactionHash
            })
        }
    }

    dumpSubmittedOps(): SubmittedUserOperation[] {
        return this.store.dumpSubmitted()
    }

    removeSubmitted(userOpHash: `0x${string}`): void {
        this.store.removeSubmitted(userOpHash)
    }

    removeProcessing(userOpHash: `0x${string}`): void {
        this.store.removeProcessing(userOpHash)
    }

    add(op: UserOperation) {
        const hash = getUserOperationHash(op, this.entryPointAddress, this.publicClient.chain.id)

        this.store.addOutstanding({
            userOperation: op,
            userOperationHash: hash,
            firstSubmitted: Date.now(),
            lastReplaced: Date.now()
        })
        this.monitor.setUserOperationStatus(hash, { status: "not_submitted", transactionHash: null })
    }

    process(maxGasLimit?: bigint, minOps?: number): UserOperation[] {
        const outstandingUserOperations = this.store.dumpOutstanding().slice()
        if (maxGasLimit) {
            let opsTaken = 0
            let gasUsed = 0n
            const result: UserOperation[] = []
            for (const opInfo of outstandingUserOperations) {
                gasUsed +=
                    opInfo.userOperation.callGasLimit +
                    opInfo.userOperation.verificationGasLimit * 3n +
                    opInfo.userOperation.preVerificationGas
                if (gasUsed > maxGasLimit && opsTaken >= (minOps || 0)) {
                    break
                }
                this.store.removeOutstanding(opInfo.userOperationHash)
                this.store.addProcessing(opInfo)
                result.push(opInfo.userOperation)
                opsTaken++
            }
            return result
        }

        return outstandingUserOperations.map((opInfo) => {
            this.store.removeOutstanding(opInfo.userOperationHash)
            this.store.addProcessing(opInfo)
            return opInfo.userOperation
        })
    }

    get(opHash: HexData32): UserOperation | null {
        const outstanding = this.store.dumpOutstanding().find((op) => op.userOperationHash === opHash)
        if (outstanding) {
            return outstanding.userOperation
        }

        const submitted = this.store.dumpSubmitted().find((op) => op.userOperation.userOperationHash === opHash)
        if (submitted) {
            return submitted.userOperation.userOperation
        }

        return null
    }
}
