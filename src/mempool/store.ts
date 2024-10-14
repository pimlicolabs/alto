import type {
    HexData32,
    SubmittedUserOperation,
    UserOperationInfo
} from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Logger } from "@alto/utils"

export class MemoryStore {
    // private monitoredTransactions: Map<HexData32, TransactionInfo> = new Map() // tx hash to info
    private outstandingUserOperations: UserOperationInfo[] = []
    private processingUserOperations: UserOperationInfo[] = []
    private submittedUserOperations: SubmittedUserOperation[] = []

    private logger: Logger
    private metrics: Metrics

    constructor(logger: Logger, metrics: Metrics) {
        this.logger = logger
        this.metrics = metrics
    }

    addOutstanding(op: UserOperationInfo) {
        const store = this.outstandingUserOperations

        store.push(op)
        this.logger.debug(
            { userOpHash: op.userOperationHash, store: "outstanding" },
            "added user op to mempool"
        )
        this.metrics.userOperationsInMempool
            .labels({
                status: "outstanding"
            })
            .inc()
    }

    addProcessing(op: UserOperationInfo) {
        const store = this.processingUserOperations

        store.push(op)
        this.logger.debug(
            { userOpHash: op.userOperationHash, store: "processing" },
            "added user op to mempool"
        )
        this.metrics.userOperationsInMempool
            .labels({
                status: "processing"
            })
            .inc()
    }

    addSubmitted(op: SubmittedUserOperation) {
        const store = this.submittedUserOperations

        store.push(op)
        this.logger.debug(
            {
                userOpHash: op.userOperation.userOperationHash,
                store: "submitted"
            },
            "added user op to submitted mempool"
        )
        this.metrics.userOperationsInMempool
            .labels({
                status: "submitted"
            })
            .inc()
    }

    removeOutstanding(userOpHash: HexData32) {
        const index = this.outstandingUserOperations.findIndex(
            (op) => op.userOperationHash === userOpHash
        )
        if (index === -1) {
            this.logger.warn(
                { userOpHash, store: "outstanding" },
                "tried to remove non-existent user op from mempool"
            )
            return
        }

        this.outstandingUserOperations.splice(index, 1)
        this.logger.debug(
            { userOpHash, store: "outstanding" },
            "removed user op from mempool"
        )
        this.metrics.userOperationsInMempool
            .labels({
                status: "outstanding"
            })
            .dec()
    }

    removeProcessing(userOpHash: HexData32) {
        const index = this.processingUserOperations.findIndex(
            (op) => op.userOperationHash === userOpHash
        )
        if (index === -1) {
            this.logger.warn(
                { userOpHash, store: "outstanding" },
                "tried to remove non-existent user op from mempool"
            )
            return
        }

        this.processingUserOperations.splice(index, 1)
        this.logger.debug(
            { userOpHash, store: "processing" },
            "removed user op from mempool"
        )
        this.metrics.userOperationsInMempool
            .labels({
                status: "processing"
            })
            .dec()
    }

    removeSubmitted(userOpHash: HexData32) {
        const index = this.submittedUserOperations.findIndex(
            (op) => op.userOperation.userOperationHash === userOpHash
        )
        if (index === -1) {
            this.logger.warn(
                { userOpHash, store: "submitted" },
                "tried to remove non-existent user op from mempool"
            )
            return
        }

        this.submittedUserOperations.splice(index, 1)
        this.logger.debug(
            { userOpHash, store: "submitted" },
            "removed user op from mempool"
        )
        this.metrics.userOperationsInMempool
            .labels({
                status: "submitted"
            })
            .dec()
    }

    dumpOutstanding(): UserOperationInfo[] {
        this.logger.trace(
            {
                store: "outstanding",
                length: this.outstandingUserOperations.length
            },
            "dumping mempool"
        )
        return this.outstandingUserOperations
    }

    dumpProcessing(): UserOperationInfo[] {
        this.logger.trace(
            {
                store: "processing",
                length: this.processingUserOperations.length
            },
            "dumping mempool"
        )
        return this.processingUserOperations
    }

    dumpSubmitted(): SubmittedUserOperation[] {
        this.logger.trace(
            { store: "submitted", length: this.submittedUserOperations.length },
            "dumping mempool"
        )
        return this.submittedUserOperations
    }

    clear(from: "outstanding" | "processing" | "submitted") {
        if (from === "outstanding") {
            this.outstandingUserOperations = []
            this.logger.debug(
                { store: from, length: this.outstandingUserOperations.length },
                "clearing mempool"
            )
        } else if (from === "processing") {
            this.processingUserOperations = []
            this.logger.debug(
                { store: from, length: this.processingUserOperations.length },
                "clearing mempool"
            )
        } else if (from === "submitted") {
            this.submittedUserOperations = []
            this.logger.debug(
                { store: from, length: this.submittedUserOperations.length },
                "clearing mempool"
            )
        } else {
            throw new Error("unreachable")
        }
    }
}
