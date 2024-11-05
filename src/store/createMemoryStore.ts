import type {
    HexData32,
    SubmittedUserOperation,
    UserOperationInfo
} from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Logger } from "@alto/utils"
import type { AltoConfig } from "@alto/config"
import type { Store } from "./index"

type MemoryStorage = {
    outstanding: UserOperationInfo[]
    processing: UserOperationInfo[]
    submitted: SubmittedUserOperation[]
}

const addOutstanding = ({
    storage,
    op,
    logger,
    metrics
}: {
    storage: MemoryStorage
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

    return [...storage.outstanding, op]
}

const addProcessing = ({
    storage,
    op,
    logger,
    metrics
}: {
    storage: MemoryStorage
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

    return [...storage.processing, op]
}

const addSubmitted = ({
    storage,
    op,
    logger,
    metrics
}: {
    storage: MemoryStorage
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

    return [...storage.submitted, op]
}

const removeOutstanding = ({
    storage,
    userOpHash,
    logger,
    metrics
}: {
    storage: MemoryStorage
    userOpHash: HexData32
    logger: Logger
    metrics: Metrics
}) => {
    const index = storage.outstanding.findIndex(
        (op) => op.userOperationHash === userOpHash
    )
    if (index === -1) {
        logger.warn(
            { userOpHash, store: "outstanding" },
            "tried to remove non-existent user op from mempool"
        )
        return [...storage.outstanding]
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

    return [
        ...storage.outstanding.slice(0, index),
        ...storage.outstanding.slice(index + 1)
    ]
}

const removeProcessing = ({
    storage,
    userOpHash,
    logger,
    metrics
}: {
    storage: MemoryStorage
    userOpHash: HexData32
    logger: Logger
    metrics: Metrics
}) => {
    const index = storage.processing.findIndex(
        (op) => op.userOperationHash === userOpHash
    )
    if (index === -1) {
        logger.warn(
            { userOpHash, store: "processing" },
            "tried to remove non-existent user op from mempool"
        )
        return [...storage.processing]
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

    return [
        ...storage.processing.slice(0, index),
        ...storage.processing.slice(index + 1)
    ]
}

const removeSubmitted = ({
    storage,
    userOpHash,
    logger,
    metrics
}: {
    storage: MemoryStorage
    userOpHash: HexData32
    logger: Logger
    metrics: Metrics
}) => {
    const index = storage.submitted.findIndex(
        (op) => op.userOperation.userOperationHash === userOpHash
    )
    if (index === -1) {
        logger.warn(
            { userOpHash, store: "submitted" },
            "tried to remove non-existent user op from mempool"
        )
        return [...storage.submitted]
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

    return [
        ...storage.submitted.slice(0, index),
        ...storage.submitted.slice(index + 1)
    ]
}

const dumpOutstanding = ({
    storage,
    logger
}: {
    storage: MemoryStorage
    logger: Logger
}): UserOperationInfo[] => {
    logger.trace(
        {
            store: "outstanding",
            length: storage.outstanding.length
        },
        "dumping mempool"
    )
    return [...storage.outstanding]
}

const dumpProcessing = ({
    storage,
    logger
}: {
    storage: MemoryStorage
    logger: Logger
}): UserOperationInfo[] => {
    logger.trace(
        {
            store: "processing",
            length: storage.processing.length
        },
        "dumping mempool"
    )
    return [...storage.processing]
}

const dumpSubmitted = ({
    storage,
    logger
}: {
    storage: MemoryStorage
    logger: Logger
}): SubmittedUserOperation[] => {
    logger.trace(
        { store: "submitted", length: storage.submitted.length },
        "dumping mempool"
    )
    return [...storage.submitted]
}

const clear = ({
    storage,
    from,
    logger
}: {
    storage: MemoryStorage
    from: "outstanding" | "processing" | "submitted"
    logger: Logger
}) => {
    if (from === "outstanding") {
        logger.debug(
            { store: from, length: storage.outstanding.length },
            "clearing mempool"
        )
        return {
            outstanding: [],
            processing: [...storage.processing],
            submitted: [...storage.submitted]
        }
    }
    if (from === "processing") {
        logger.debug(
            { store: from, length: storage.processing.length },
            "clearing mempool"
        )
        return {
            outstanding: [...storage.outstanding],
            processing: [],
            submitted: [...storage.submitted]
        }
    }
    if (from === "submitted") {
        logger.debug(
            { store: from, length: storage.submitted.length },
            "clearing mempool"
        )
        return {
            outstanding: [...storage.outstanding],
            processing: [...storage.processing],
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
}): Store => {
    const logger = config.getLogger(
        { module: "mempool" },
        {
            level: config.logLevel
        }
    )

    const storage: MemoryStorage = {
        outstanding: [],
        processing: [],
        submitted: []
    }

    return {
        process: ({ maxTime }, callback) => {
            const interval = setInterval(() => {
                if (storage.outstanding.length > 0) {
                    callback(storage.outstanding)
                }
            }, maxTime)

            return () => clearInterval(interval)
        },
        addOutstanding: (op) => {
            storage.outstanding = addOutstanding({
                storage,
                op,
                logger,
                metrics
            })
            return Promise.resolve()
        },
        addProcessing: (op) => {
            storage.processing = addProcessing({
                storage,
                op,
                logger,
                metrics
            })
            return Promise.resolve()
        },
        addSubmitted: (op) => {
            storage.submitted = addSubmitted({
                storage,
                op,
                logger,
                metrics
            })
            return Promise.resolve()
        },
        removeOutstanding: (userOpHash) => {
            storage.outstanding = removeOutstanding({
                storage,
                userOpHash,
                logger,
                metrics
            })
            return Promise.resolve()
        },
        removeProcessing: (userOpHash) => {
            storage.processing = removeProcessing({
                storage,
                userOpHash,
                logger,
                metrics
            })
            return Promise.resolve()
        },
        removeSubmitted: (userOpHash) => {
            storage.submitted = removeSubmitted({
                storage,
                userOpHash,
                logger,
                metrics
            })
            return Promise.resolve()
        },
        dumpOutstanding: () =>
            Promise.resolve(dumpOutstanding({ storage, logger })),
        dumpProcessing: () =>
            Promise.resolve(dumpProcessing({ storage, logger })),
        dumpSubmitted: () =>
            Promise.resolve(dumpSubmitted({ storage, logger })),
        clear: (from) => {
            const newStorage = clear({ storage, from, logger })
            storage.outstanding = newStorage.outstanding
            storage.processing = newStorage.processing
            storage.submitted = newStorage.submitted
            return Promise.resolve()
        }
    }
}
