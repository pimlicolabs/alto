import {
    deriveUserOperation,
    type HexData32,
    type SubmittedUserOperation,
    type UserOperationInfo
} from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Logger } from "@alto/utils"
import type { AltoConfig } from "@alto/config"
import type { Store } from "./index"

const addOutstanding = ({
    outstanding,
    op,
    logger,
    metrics
}: {
    outstanding: UserOperationInfo[]
    op: UserOperationInfo
    logger: Logger
    metrics: Metrics
}) => {
    logger.debug(
        { userOpHash: op.userOperationHash, store: "outstanding" },
        "added user op to mempool"
    )
    metrics.userOperationsInMempool
        .labels({
            status: "outstanding"
        })
        .inc()

    return [...outstanding, op]
}

const addProcessing = ({
    processing,
    op,
    logger,
    metrics
}: {
    processing: UserOperationInfo[]
    op: UserOperationInfo
    logger: Logger
    metrics: Metrics
}) => {
    logger.debug(
        { userOpHash: op.userOperationHash, store: "processing" },
        "added user op to mempool"
    )
    metrics.userOperationsInMempool
        .labels({
            status: "processing"
        })
        .inc()

    return [...processing, op]
}

const addSubmitted = ({
    submitted,
    op,
    logger,
    metrics
}: {
    submitted: SubmittedUserOperation[]
    op: SubmittedUserOperation
    logger: Logger
    metrics: Metrics
}) => {
    logger.debug(
        {
            userOpHash: op.userOperation.userOperationHash,
            store: "submitted"
        },
        "added user op to submitted mempool"
    )
    metrics.userOperationsInMempool
        .labels({
            status: "submitted"
        })
        .inc()

    return [...submitted, op]
}

const removeOutstanding = ({
    outstanding,
    userOpHash,
    logger,
    metrics
}: {
    outstanding: UserOperationInfo[]
    userOpHash: HexData32
    logger: Logger
    metrics: Metrics
}) => {
    const index = outstanding.findIndex(
        (op) => op.userOperationHash === userOpHash
    )
    if (index === -1) {
        logger.warn(
            { userOpHash, store: "outstanding" },
            "tried to remove non-existent user op from mempool"
        )
        return [...outstanding]
    }

    logger.debug(
        { userOpHash, store: "outstanding" },
        "removed user op from mempool"
    )
    metrics.userOperationsInMempool
        .labels({
            status: "outstanding"
        })
        .dec()

    return [...outstanding.slice(0, index), ...outstanding.slice(index + 1)]
}

const removeProcessing = ({
    processing,
    userOpHash,
    logger,
    metrics
}: {
    processing: UserOperationInfo[]
    userOpHash: HexData32
    logger: Logger
    metrics: Metrics
}) => {
    const index = processing.findIndex(
        (op) => op.userOperationHash === userOpHash
    )
    if (index === -1) {
        logger.warn(
            { userOpHash, store: "processing" },
            "tried to remove non-existent user op from mempool"
        )
        return [...processing]
    }

    logger.debug(
        { userOpHash, store: "processing" },
        "removed user op from mempool"
    )
    metrics.userOperationsInMempool
        .labels({
            status: "processing"
        })
        .dec()

    return [...processing.slice(0, index), ...processing.slice(index + 1)]
}

const removeSubmitted = ({
    submitted,
    userOpHash,
    logger,
    metrics
}: {
    submitted: SubmittedUserOperation[]
    userOpHash: HexData32
    logger: Logger
    metrics: Metrics
}) => {
    const index = submitted.findIndex(
        (op) => op.userOperation.userOperationHash === userOpHash
    )
    if (index === -1) {
        logger.warn(
            { userOpHash, store: "submitted" },
            "tried to remove non-existent user op from mempool"
        )
        return [...submitted]
    }

    logger.debug(
        { userOpHash, store: "submitted" },
        "removed user op from mempool"
    )
    metrics.userOperationsInMempool
        .labels({
            status: "submitted"
        })
        .dec()

    return [...submitted.slice(0, index), ...submitted.slice(index + 1)]
}

const dumpOutstanding = ({
    outstanding,
    logger
}: {
    outstanding: UserOperationInfo[]
    logger: Logger
}): UserOperationInfo[] => {
    logger.trace(
        {
            store: "outstanding",
            length: outstanding.length
        },
        "dumping mempool"
    )
    return [...outstanding]
}

const dumpProcessing = ({
    processing,
    logger
}: {
    processing: UserOperationInfo[]
    logger: Logger
}): UserOperationInfo[] => {
    logger.trace(
        {
            store: "processing",
            length: processing.length
        },
        "dumping mempool"
    )
    return [...processing]
}

const dumpSubmitted = ({
    submitted,
    logger
}: {
    submitted: SubmittedUserOperation[]
    logger: Logger
}): SubmittedUserOperation[] => {
    logger.trace(
        { store: "submitted", length: submitted.length },
        "dumping mempool"
    )
    return [...submitted]
}

const clear = ({
    outstanding,
    processing,
    submitted,
    from,
    logger
}: {
    outstanding: UserOperationInfo[]
    processing: UserOperationInfo[]
    submitted: SubmittedUserOperation[]
    from: "outstanding" | "processing" | "submitted"
    logger: Logger
}) => {
    if (from === "outstanding") {
        logger.debug(
            { store: from, length: outstanding.length },
            "clearing mempool"
        )
        return {
            outstanding: [],
            processing: [...processing],
            submitted: [...submitted]
        }
    }
    if (from === "processing") {
        logger.debug(
            { store: from, length: processing.length },
            "clearing mempool"
        )
        return {
            outstanding: [...outstanding],
            processing: [],
            submitted: [...submitted]
        }
    }
    if (from === "submitted") {
        logger.debug(
            { store: from, length: submitted.length },
            "clearing mempool"
        )
        return {
            outstanding: [...outstanding],
            processing: [...processing],
            submitted: []
        }
    }
    throw new Error("unreachable")
}

export const createMemoryStore = ({
    config,
    metrics
}: {
    config: AltoConfig
    metrics: Metrics
}): Store<{
    outstanding: UserOperationInfo[]
    processing: UserOperationInfo[]
    submitted: SubmittedUserOperation[]
    logger: Logger
}> => {
    return {
        outstanding: [],
        processing: [],
        submitted: [],
        logger: config.getLogger(
            { module: "mempool" },
            {
                level: config.logLevel
            }
        ),
        process({ maxTime, maxGasLimit, immediate }, callback) {
            const getOpsToBundle = () => {
                let gasUsed = 0n
                const filteredOps = this.outstanding.filter((opInfo) => {
                    const op = deriveUserOperation(opInfo.mempoolUserOperation)
                    const opGasLimit =
                        op.callGasLimit +
                        op.verificationGasLimit * 3n +
                        op.preVerificationGas

                    if (gasUsed + opGasLimit < maxGasLimit) {
                        gasUsed += opGasLimit
                        return true
                    }
                    return false
                })

                return filteredOps
            }

            const processOps = () => {
                const filteredOps = getOpsToBundle()
                if (filteredOps.length > 0) {
                    const removeHashes = new Set(
                        filteredOps.map((op) => op.userOperationHash)
                    )
                    this.outstanding = this.outstanding.filter(
                        (opInfo) => !removeHashes.has(opInfo.userOperationHash)
                    )

                    callback([...filteredOps])
                }
            }

            const interval = setInterval(processOps, maxTime)

            if (immediate) {
                processOps()
            }

            return () => clearInterval(interval)
        },
        addOutstanding(op) {
            this.outstanding = addOutstanding({
                outstanding: this.outstanding,
                op,
                logger: this.logger,
                metrics
            })
            return Promise.resolve()
        },
        addProcessing(op) {
            this.processing = addProcessing({
                processing: this.processing,
                op,
                logger: this.logger,
                metrics
            })
            return Promise.resolve()
        },
        addSubmitted(op) {
            this.submitted = addSubmitted({
                submitted: this.submitted,
                op,
                logger: this.logger,
                metrics
            })
            return Promise.resolve()
        },
        removeOutstanding(userOpHash) {
            this.outstanding = removeOutstanding({
                outstanding: this.outstanding,
                userOpHash,
                logger: this.logger,
                metrics
            })
            return Promise.resolve()
        },
        removeProcessing(userOpHash) {
            this.processing = removeProcessing({
                processing: this.processing,
                userOpHash,
                logger: this.logger,
                metrics
            })
            return Promise.resolve()
        },
        removeSubmitted(userOpHash) {
            this.submitted = removeSubmitted({
                submitted: this.submitted,
                userOpHash,
                logger: this.logger,
                metrics
            })
            return Promise.resolve()
        },
        dumpOutstanding() {
            return Promise.resolve(
                dumpOutstanding({
                    outstanding: this.outstanding,
                    logger: this.logger
                })
            )
        },
        dumpProcessing() {
            return Promise.resolve(
                dumpProcessing({
                    processing: this.processing,
                    logger: this.logger
                })
            )
        },
        dumpSubmitted() {
            return Promise.resolve(
                dumpSubmitted({
                    submitted: this.submitted,
                    logger: this.logger
                })
            )
        },
        clear(from) {
            const newStorage = clear({
                outstanding: this.outstanding,
                processing: this.processing,
                submitted: this.submitted,
                from,
                logger: this.logger
            })
            this.outstanding = newStorage.outstanding
            this.processing = newStorage.processing
            this.submitted = newStorage.submitted
            return Promise.resolve()
        }
    }
}
