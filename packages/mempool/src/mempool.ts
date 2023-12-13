// import { MongoClient, Collection, Filter } from "mongodb"
// import { PublicClient, getContract } from "viem"
// import { EntryPointAbi } from "../types/EntryPoint"
import {
    RpcError,
    SubmittedUserOperation,
    TransactionInfo,
    UserOperation,
    UserOperationInfo,
    ValidationErrors
} from "@alto/types"
import { HexData32 } from "@alto/types"
import { Monitor } from "./monitoring"
import { Address, Chain, PublicClient, Transport } from "viem"
import {
    Logger,
    Metrics,
    getAddressFromInitCodeOrPaymasterAndData,
    getUserOperationHash
} from "@alto/utils"
import { MemoryStore } from "./store"
import { IReputationManager } from "./reputationManager"

export interface Mempool {
    add(op: UserOperation): boolean
    checkMultipleRolesViolation(op: UserOperation): Promise<void>

    /**
     * Takes an array of user operations from the mempool, also marking them as submitted.
     *
     * @param gasLimit The maximum gas limit of user operations to take.
     * @param minOps The minimum number of user operations to take.
     * @returns An array of user operations to submit.
     */
    process(gasLimit?: bigint, minOps?: number): UserOperation[]

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

    clear(): void
}

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
    removeSubmitted(_: `0x${string}`): void {
        throw new Error("Method not implemented.")
    }
    add(_op: UserOperation) {
        return false
    }
    async checkMultipleRolesViolation(_op: UserOperation): Promise<void> {
        return
    }

    process(_?: bigint, __?: number): UserOperation[] {
        return []
    }
}

export class MemoryMempool implements Mempool {
    private monitor: Monitor
    private publicClient: PublicClient<Transport, Chain>
    private entryPointAddress: Address
    private reputationManager: IReputationManager
    private store: MemoryStore

    constructor(
        monitor: Monitor,
        reputationManager: IReputationManager,
        publicClient: PublicClient<Transport, Chain>,
        entryPointAddress: Address,
        logger: Logger,
        metrics: Metrics
    ) {
        this.reputationManager = reputationManager
        this.monitor = monitor
        this.publicClient = publicClient
        this.entryPointAddress = entryPointAddress
        this.store = new MemoryStore(logger, metrics)
    }

    replaceSubmitted(
        userOperation: UserOperationInfo,
        transactionInfo: TransactionInfo
    ): void {
        const op = this.store
            .dumpSubmitted()
            .find(
                (op) =>
                    op.userOperation.userOperationHash ===
                    userOperation.userOperationHash
            )
        if (op) {
            this.store.removeSubmitted(userOperation.userOperationHash)
            this.store.addSubmitted({
                userOperation,
                transactionInfo
            })
            this.monitor.setUserOperationStatus(
                userOperation.userOperationHash,
                {
                    status: "submitted",
                    transactionHash: transactionInfo.transactionHash
                }
            )
        }
    }

    markSubmitted(
        userOpHash: `0x${string}`,
        transactionInfo: TransactionInfo
    ): void {
        const op = this.store
            .dumpProcessing()
            .find((op) => op.userOperationHash === userOpHash)
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

    dumpOutstanding(): UserOperationInfo[] {
        return this.store.dumpOutstanding()
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

    async checkMultipleRolesViolation(op: UserOperation): Promise<void> {
        const knownEntities = this.getKnownEntities()

        if (
            knownEntities.paymasters.has(op.sender.toLowerCase() as Address) ||
            knownEntities.facotries.has(op.sender.toLowerCase() as Address)
        ) {
            throw new RpcError(
                `The sender address "${op.sender}" is used as a different entity in another UserOperation currently in mempool`,
                ValidationErrors.OpcodeValidation
            )
        }

        const paymaster = getAddressFromInitCodeOrPaymasterAndData(
            op.paymasterAndData
        )

        if (paymaster && knownEntities.sender.has(paymaster.toLowerCase() as Address)) {
            throw new RpcError(
                `A Paymaster at ${paymaster} in this UserOperation is used as a sender entity in another UserOperation currently in mempool.`,
                ValidationErrors.OpcodeValidation
            )
        }


        const factory = getAddressFromInitCodeOrPaymasterAndData(op.initCode)

        if (factory && knownEntities.sender.has(factory.toLowerCase() as Address)) {
            throw new RpcError(
                `A Factory at ${factory} in this UserOperation is used as a sender entity in another UserOperation currently in mempool.`,
                ValidationErrors.OpcodeValidation
            )
        }

    }

    getKnownEntities(): {
        sender: Set<Address>
        paymasters: Set<Address>
        facotries: Set<Address>
    } {
        const allOps = [...this.store.dumpOutstanding()]

        const entities: {
            sender: Set<Address>
            paymasters: Set<Address>
            facotries: Set<Address>
        } = {
            sender: new Set(),
            paymasters: new Set(),
            facotries: new Set()
        }

        for (const op of allOps) {
            entities.sender.add(
                op.userOperation.sender.toLowerCase() as Address
            )
            const paymaster = getAddressFromInitCodeOrPaymasterAndData(
                op.userOperation.paymasterAndData
            )
            if (paymaster) {
                entities.paymasters.add(paymaster.toLowerCase() as Address)
            }
            const factory = getAddressFromInitCodeOrPaymasterAndData(
                op.userOperation.initCode
            )
            if (factory) {
                entities.facotries.add(factory.toLowerCase() as Address)
            }
        }

        return entities
    }

    add(op: UserOperation) {
        const outstandingOps = [...this.store.dumpOutstanding()]

        const processedOrSubmittedOps = [
            ...this.store.dumpProcessing(),
            ...this.store.dumpSubmitted().map((sop) => sop.userOperation)
        ]

        if (
            processedOrSubmittedOps.find(
                (uo) =>
                    uo.userOperation.sender === op.sender &&
                    uo.userOperation.nonce === op.nonce
            )
        ) {
            return false
        }

        this.reputationManager.updateUserOperationSeenStatus(op)
        const oldUserOp = outstandingOps.find(
            (uo) =>
                uo.userOperation.sender === op.sender &&
                uo.userOperation.nonce === op.nonce
        )
        if (oldUserOp) {
            const oldMaxPriorityFeePerGas =
                oldUserOp.userOperation.maxPriorityFeePerGas
            const newMaxPriorityFeePerGas = op.maxPriorityFeePerGas
            const oldMaxFeePerGas = oldUserOp.userOperation.maxFeePerGas
            const newMaxFeePerGas = op.maxFeePerGas

            const incrementMaxPriorityFeePerGas =
                (oldMaxPriorityFeePerGas * BigInt(10)) / BigInt(100)
            const incrementMaxFeePerGas =
                (oldMaxFeePerGas * BigInt(10)) / BigInt(100)

            if (
                newMaxPriorityFeePerGas <
                    oldMaxPriorityFeePerGas + incrementMaxPriorityFeePerGas ||
                newMaxFeePerGas < oldMaxFeePerGas + incrementMaxFeePerGas
            ) {
                return false
            }

            this.store.removeOutstanding(oldUserOp.userOperationHash)
        }

        const hash = getUserOperationHash(
            op,
            this.entryPointAddress,
            this.publicClient.chain.id
        )

        this.store.addOutstanding({
            userOperation: op,
            userOperationHash: hash,
            firstSubmitted: oldUserOp ? oldUserOp.firstSubmitted : Date.now(),
            lastReplaced: Date.now()
        })
        this.monitor.setUserOperationStatus(hash, {
            status: "not_submitted",
            transactionHash: null
        })

        return true
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
                this.reputationManager.decreaseUserOperationCount(
                    opInfo.userOperation
                )
                this.store.removeOutstanding(opInfo.userOperationHash)
                this.store.addProcessing(opInfo)
                result.push(opInfo.userOperation)
                opsTaken++
            }
            return result
        }

        return outstandingUserOperations.map((opInfo) => {
            this.reputationManager.decreaseUserOperationCount(
                opInfo.userOperation
            )
            this.store.removeOutstanding(opInfo.userOperationHash)
            this.store.addProcessing(opInfo)
            return opInfo.userOperation
        })
    }

    get(opHash: HexData32): UserOperation | null {
        const outstanding = this.store
            .dumpOutstanding()
            .find((op) => op.userOperationHash === opHash)
        if (outstanding) {
            return outstanding.userOperation
        }

        const submitted = this.store
            .dumpSubmitted()
            .find((op) => op.userOperation.userOperationHash === opHash)
        if (submitted) {
            return submitted.userOperation.userOperation
        }

        return null
    }

    clear(): void {
        this.store.clear("outstanding")
    }
}
