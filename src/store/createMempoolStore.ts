import type { HexData32, SubmittedUserOp, UserOpInfo } from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Logger } from "@alto/utils"
import {
    BaseStore,
    MempoolStore,
    OutstandingStore,
    Store,
    StoreType,
    UserOpType
} from "."
import { AltoConfig } from "../createConfig"
import { createMemoryOutstandingQueue } from "./createMemoryOutstandingStore"
import { createStore } from "./createStore"
import { Address } from "viem"
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

    const storeHandlers: Map<
        Address,
        {
            processing: Store<UserOpInfo>
            submitted: Store<SubmittedUserOp>
            outstanding: OutstandingStore
        }
    > = new Map()

    for (const entryPoint of config.entrypoints) {
        const processing = createStore<UserOpInfo>({
            config
        })
        const submitted = createStore<SubmittedUserOp>({
            config
        })

        let outstanding: OutstandingStore
        if (config.redisMempoolUrl) {
            outstanding = createRedisOutstandingQueue({
                config
            })
            logger.info("Using redis for outstanding mempool")
        } else {
            outstanding = createMemoryOutstandingQueue({
                config
            })
            logger.info("Using memory for outstanding mempool")
        }

        storeHandlers.set(entryPoint, {
            processing,
            submitted,
            outstanding
        })
    }

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
        store: BaseStore<T>
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
        popOutstanding: async (entryPoint: Address) => {
            const outstanding = storeHandlers.get(entryPoint)?.outstanding
            if (!outstanding) {
                throw new Error("unexpected error")
            }

            return await outstanding.pop()
        },
        peekOutstanding: async (entryPoint: Address) => {
            const outstanding = storeHandlers.get(entryPoint)?.outstanding
            if (!outstanding) {
                throw new Error("unexpected error")
            }

            return await outstanding.peek()
        },
        addOutstanding: async ({
            entryPoint,
            userOpInfo
        }: { entryPoint: Address; userOpInfo: UserOpInfo }) => {
            const outstanding = storeHandlers.get(entryPoint)?.outstanding
            if (!outstanding) {
                throw new Error("unexpected error")
            }

            logAddOperation(userOpInfo.userOpHash, "outstanding")
            await outstanding.add({ userOpInfo })
        },
        addProcessing: async ({
            entryPoint,
            userOpInfo
        }: {
            entryPoint: Address
            userOpInfo: UserOpInfo
        }) => {
            const processing = storeHandlers.get(entryPoint)?.processing
            if (!processing) {
                throw new Error("unexpected error")
            }

            logAddOperation(userOpInfo.userOpHash, "processing")
            await processing.add({ op: userOpInfo })
        },
        addSubmitted: async ({
            entryPoint,
            submittedUserOp
        }: {
            entryPoint: Address
            submittedUserOp: SubmittedUserOp
        }) => {
            const submitted = storeHandlers.get(entryPoint)?.submitted
            if (!submitted) {
                throw new Error("unexpected error")
            }

            logAddOperation(submittedUserOp.userOpHash, "submitted")
            await submitted.add({ op: submittedUserOp })
        },
        removeOutstanding: async ({
            entryPoint,
            userOpHash
        }: {
            entryPoint: Address
            userOpHash: HexData32
        }) => {
            const outstanding = storeHandlers.get(entryPoint)?.outstanding
            if (!outstanding) {
                throw new Error("unexpected error")
            }
            const removed = await outstanding.remove({ userOpHash })
            logRemoveOperation(userOpHash, "outstanding", removed)
        },
        removeProcessing: async ({
            entryPoint,
            userOpHash
        }: {
            entryPoint: Address
            userOpHash: HexData32
        }) => {
            const processing = storeHandlers.get(entryPoint)?.processing
            if (!processing) {
                throw new Error("unexpected error")
            }
            const removed = await processing.remove({ userOpHash })
            logRemoveOperation(userOpHash, "processing", removed)
        },
        removeSubmitted: async ({
            entryPoint,
            userOpHash
        }: {
            entryPoint: Address
            userOpHash: HexData32
        }) => {
            const submitted = storeHandlers.get(entryPoint)?.submitted
            if (!submitted) {
                throw new Error("unexpected error")
            }
            const removed = await submitted.remove({ userOpHash })
            logRemoveOperation(userOpHash, "submitted", removed)
        },
        dumpOutstanding: async (entryPoint: Address) => {
            const outstanding = storeHandlers.get(entryPoint)?.outstanding
            if (!outstanding) {
                throw new Error("unexpected error")
            }
            await logDumpOperation("outstanding", outstanding)
            return await outstanding.dump()
        },
        dumpProcessing: async (entryPoint: Address) => {
            const processing = storeHandlers.get(entryPoint)?.processing
            if (!processing) {
                throw new Error("unexpected error")
            }
            await logDumpOperation("processing", processing)
            return await processing.dump()
        },
        dumpSubmitted: async (entryPoint: Address) => {
            const submitted = storeHandlers.get(entryPoint)?.submitted
            if (!submitted) {
                throw new Error("unexpected error")
            }
            await logDumpOperation("submitted", submitted)
            return await submitted.dump()
        },
        clear: async ({
            entryPoint,
            from
        }: { entryPoint: Address; from: StoreType }) => {
            const stores = storeHandlers.get(entryPoint)
            if (!stores) {
                throw new Error("unexpected error")
            }

            if (from === "outstanding") {
                await stores.outstanding.clear()
            } else if (from === "processing") {
                await stores.processing.clear()
            } else if (from === "submitted") {
                await stores.submitted.clear()
            }

            logger.debug({ store: from }, "cleared mempool")
        }
    }
}
