import type { HexData32, SubmittedUserOp, UserOpInfo } from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Logger } from "@alto/utils"
import { MempoolStore, OutstandingStore, Store, StoreType, UserOpType } from "."
import { AltoConfig } from "../createConfig"
import { createMemoryOutstandingQueue } from "./createMemoryOutstandingStore"
import { createStore } from "./createStore"

export const createMempoolStore = ({
    config,
    metrics
}: { config: AltoConfig; metrics: Metrics }): MempoolStore => {
    let logger: Logger = config.getLogger(
        { module: "memory-store" },
        {
            level: config.logLevel
        }
    )

    let outstanding: OutstandingStore
    if (config.redisMempoolUrl) {
        outstanding = createMemoryOutstandingQueue({ config })
    } else {
        outstanding = createMemoryOutstandingQueue({ config })
    }

    let processing = createStore<UserOpInfo>({
        config
    })
    const submitted = createStore<SubmittedUserOp>({
        config
    })

    const logAddOperation = (userOpHash: HexData32, storeType: StoreType) => {
        logger.debug(
            { userOpHash, store: storeType },
            `added user op to ${storeType} mempool`
        )
        metrics.userOperationsInMempool.labels({ status: storeType }).inc()
    }

    const logRemoveOperation = (
        userOpHash: HexData32,
        storeType: StoreType,
        removed: boolean
    ) => {
        if (!removed) {
            logger.warn(
                { userOpHash, store: storeType },
                "tried to remove non-existent user op from mempool"
            )
            return
        }

        logger.debug(
            { userOpHash, store: storeType },
            "removed user op from mempool"
        )

        metrics.userOperationsInMempool.labels({ status: storeType }).dec()
    }

    const logDumpOperation = async <T extends UserOpType>(
        storeType: StoreType,
        store: Store<T>
    ) => {
        logger.trace(
            {
                store: storeType,
                length: await store.length()
            },
            "dumping mempool"
        )
    }

    return {
        addOutstanding: async (userOpInfo: UserOpInfo) => {
            logAddOperation(userOpInfo.userOpHash, "outstanding")
            outstanding.add(userOpInfo)
            return Promise.resolve()
        },
        addProcessing: async (userOpInfo: UserOpInfo) => {
            logAddOperation(userOpInfo.userOpHash, "processing")
            processing.add(userOpInfo)
            return Promise.resolve()
        },
        addSubmitted: async (userOpInfo: SubmittedUserOp) => {
            logAddOperation(userOpInfo.userOpHash, "submitted")
            submitted.add(userOpInfo)
            return Promise.resolve()
        },
        removeOutstanding: async (userOpHash: HexData32) => {
            const removed = await outstanding.remove(userOpHash)
            logRemoveOperation(userOpHash, "outstanding", removed)
            return Promise.resolve()
        },
        removeProcessing: async (userOpHash: HexData32) => {
            const removed = await processing.remove(userOpHash)
            logRemoveOperation(userOpHash, "processing", removed)
            return Promise.resolve()
        },
        removeSubmitted: async (userOpHash: HexData32) => {
            const removed = await submitted.remove(userOpHash)
            logRemoveOperation(userOpHash, "submitted", removed)
            return Promise.resolve()
        },
        dumpOutstanding: async () => {
            await logDumpOperation("outstanding", outstanding)
            return outstanding.dump()
        },
        dumpProcessing: async () => {
            await logDumpOperation("processing", processing)
            return processing.dump()
        },
        dumpSubmitted: async () => {
            await logDumpOperation("submitted", submitted)
            return submitted.dump()
        },
        clear: async (from: StoreType) => {
            if (from === "outstanding") {
                outstanding.clear()
            } else if (from === "processing") {
                processing.clear()
            } else if (from === "submitted") {
                submitted.clear()
            }

            logger.debug({ store: from }, "cleared mempool")
            return Promise.resolve()
        }
    }
}
