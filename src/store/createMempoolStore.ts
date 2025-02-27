import type { HexData32, SubmittedUserOp, UserOpInfo } from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Logger } from "@alto/utils"
import { MempoolStore, OutstandingStore, Store, StoreType, UserOpType } from "."
import { AltoConfig } from "../createConfig"
import { createMemoryOutstandingQueue } from "./createMemoryOutstandingStore"
import { createStore } from "./createStore"
import { createRedisOutstandingQueue } from "./createRedisOutstandingStore"

export const createMempoolStore = ({
    config,
    metrics
}: { config: AltoConfig; metrics: Metrics }): MempoolStore => {
    let logger: Logger = config.getLogger(
        { module: "mempool-store" },
        {
            level: config.logLevel
        }
    )

    let outstanding: OutstandingStore
    if (config.redisMempoolUrl) {
        outstanding = createRedisOutstandingQueue({ config })
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
            await outstanding.add(userOpInfo)
        },
        addProcessing: async (userOpInfo: UserOpInfo) => {
            logAddOperation(userOpInfo.userOpHash, "processing")
            await processing.add(userOpInfo)
        },
        addSubmitted: async (userOpInfo: SubmittedUserOp) => {
            logAddOperation(userOpInfo.userOpHash, "submitted")
            await submitted.add(userOpInfo)
        },
        removeOutstanding: async (userOpHash: HexData32) => {
            const removed = await outstanding.remove(userOpHash)
            logRemoveOperation(userOpHash, "outstanding", removed)
        },
        removeProcessing: async (userOpHash: HexData32) => {
            const removed = await processing.remove(userOpHash)
            logRemoveOperation(userOpHash, "processing", removed)
        },
        removeSubmitted: async (userOpHash: HexData32) => {
            const removed = await submitted.remove(userOpHash)
            logRemoveOperation(userOpHash, "submitted", removed)
        },
        dumpOutstanding: async () => {
            await logDumpOperation("outstanding", outstanding)
            return await outstanding.dump()
        },
        dumpProcessing: async () => {
            await logDumpOperation("processing", processing)
            return await processing.dump()
        },
        dumpSubmitted: async () => {
            await logDumpOperation("submitted", submitted)
            return await submitted.dump()
        },
        clear: async (from: StoreType) => {
            if (from === "outstanding") {
                await outstanding.clear()
            } else if (from === "processing") {
                await processing.clear()
            } else if (from === "submitted") {
                await submitted.clear()
            }

            logger.debug({ store: from }, "cleared mempool")
        }
    }
}
