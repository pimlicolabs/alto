import type { HexData32, SubmittedUserOp, UserOpInfo } from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Logger } from "@alto/utils"
import { Store } from "."
import { AltoConfig } from "../createConfig"
import { createMemoryOutstandingQueue } from "./createMemoryOutstandingStore"

type StoreType = "outstanding" | "processing" | "submitted"
type UserOpType = UserOpInfo | SubmittedUserOp

const addToStore = <T extends UserOpType>({
    op,
    store,
    logger,
    metrics,
    storeType
}: {
    op: T
    store: T[]
    logger: Logger
    metrics: Metrics
    storeType: StoreType
}) => {
    logger.debug(
        { userOpHash: op.userOpHash, store: storeType },
        `added user op to ${storeType} mempool`
    )
    metrics.userOperationsInMempool.labels({ status: storeType }).inc()
    return [...store, op]
}

const removeFromStore = <T extends UserOpType>({
    userOpHash,
    logger,
    metrics,
    store,
    storeType
}: {
    userOpHash: HexData32
    logger: Logger
    metrics: Metrics
    store: T[]
    storeType: StoreType
}) => {
    const exists = store.some((op) => op.userOpHash === userOpHash)

    if (!exists) {
        logger.warn(
            { userOpHash, store: storeType },
            "tried to remove non-existent user op from mempool"
        )
        return [...store]
    }

    logger.debug(
        { userOpHash, store: storeType },
        "removed user op from mempool"
    )
    metrics.userOperationsInMempool.labels({ status: storeType }).dec()
    return store.filter((op) => op.userOpHash !== userOpHash)
}

const dumpStore = <T extends UserOpType>({
    store,
    logger,
    storeType
}: {
    store: T[]
    logger: Logger
    storeType: StoreType
}) => {
    logger.trace(
        {
            store: storeType,
            length: store.length
        },
        "dumping mempool"
    )
    return [...store]
}

const clear = ({
    processing,
    submitted,
    from,
    logger
}: {
    processing: UserOpInfo[]
    submitted: SubmittedUserOp[]
    from: "processing" | "submitted"
    logger: Logger
}) => {
    if (from === "processing") {
        logger.debug(
            { store: from, length: processing.length },
            "clearing mempool"
        )
        return {
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
            processing: [...processing],
            submitted: []
        }
    }
    throw new Error("unreachable")
}

export const createMemoryStore = ({
    config,
    metrics
}: { config: AltoConfig; metrics: Metrics }): Store => {
    const outstanding = createMemoryOutstandingQueue({ config })
    let processing: UserOpInfo[] = []
    let submitted: SubmittedUserOp[] = []
    let logger: Logger = config.getLogger(
        { module: "memory_store" },
        {
            level: config.logLevel
        }
    )

    logger.info("Created memory store")
    return {
        addOutstanding: async (userOpInfo: UserOpInfo) => {
            outstanding.add(userOpInfo)
        },
        addProcessing: async (userOpInfo: UserOpInfo) => {
            processing = addToStore({
                op: userOpInfo,
                store: processing,
                storeType: "processing",
                logger,
                metrics
            })
        },
        addSubmitted: async (userOpInfo: SubmittedUserOp) => {
            submitted = addToStore({
                op: userOpInfo,
                store: submitted,
                storeType: "submitted",
                logger,
                metrics
            })
        },
        removeOutstanding: async (userOpHash: HexData32) => {
            outstanding.remove(userOpHash)
            return Promise.resolve()
        },
        removeProcessing: async (userOpHash: HexData32) => {
            processing = removeFromStore({
                userOpHash,
                store: processing,
                storeType: "processing",
                logger,
                metrics
            })
            return Promise.resolve()
        },
        removeSubmitted: async (userOpHash: HexData32) => {
            submitted = removeFromStore({
                userOpHash,
                store: submitted,
                storeType: "submitted",
                logger,
                metrics
            })
            return Promise.resolve()
        },
        dumpOutstanding: async () => {
            return outstanding.dump()
        },
        dumpProcessing: async () => {
            return dumpStore({
                store: processing,
                storeType: "processing",
                logger
            })
        },
        dumpSubmitted: async () => {
            return dumpStore({
                store: submitted,
                storeType: "submitted",
                logger
            })
        },
        clear: async (from: "outstanding" | "processing" | "submitted") => {
            if (from === "outstanding") {
                outstanding.clear()
                return Promise.resolve()
            }

            const newStorage = clear({
                processing: processing,
                submitted: submitted,
                from,
                logger
            })
            processing = newStorage.processing
            submitted = newStorage.submitted
            return Promise.resolve()
        }
    }
}
