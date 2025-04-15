import {
    UserOperation,
    type HexData32,
    type SubmittedUserOp,
    type UserOpInfo
} from "@alto/types"
import { type Metrics } from "@alto/utils"
import type { Logger } from "@alto/utils"
import {
    Store,
    MempoolStore,
    OutstandingStore,
    StoreType,
    EntryPointUserOpHashParam,
    EntryPointSubmittedUserOpParam,
    EntryPointUserOpInfoParam
} from "."
import { AltoConfig } from "../createConfig"
import { createMemoryOutstandingQueue } from "./createMemoryOutstandingStore"
import { createMemoryStore } from "./createStore"
import { Address } from "viem"
import { createRedisOutstandingQueue } from "./createRedisOutstandingStore"
import { createRedisStore } from "./createRedisStore"

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

    // Helper function to get store handlers for an entry point
    const getStoreHandlers = (entryPoint: Address) => {
        const handlers = storeHandlers.get(entryPoint)
        if (!handlers) {
            throw new Error(
                `No store handlers found for entry point ${entryPoint}`
            )
        }
        return handlers
    }

    for (const entryPoint of config.entrypoints) {
        let outstanding: OutstandingStore
        let processing: Store<UserOpInfo>
        let submitted: Store<SubmittedUserOp>
        if (config.redisMempoolUrl) {
            outstanding = createRedisOutstandingQueue({
                config,
                entryPoint
            })
            processing = createRedisStore<UserOpInfo>({
                config,
                entryPoint,
                storeType: "processing"
            })
            submitted = createRedisStore<SubmittedUserOp>({
                config,
                entryPoint,
                storeType: "submitted"
            })
            logger.info(
                "Using redis for outstanding, processing, submitted mempools"
            )
        } else {
            outstanding = createMemoryOutstandingQueue({
                config
            })
            processing = createMemoryStore<UserOpInfo>({
                config
            })
            submitted = createMemoryStore<SubmittedUserOp>({
                config
            })
            logger.info(
                "Using memory for outstanding, processing, submitted mempools"
            )
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

    const logDumpOperation = (storeType: StoreType) => {
        logger.trace(
            {
                store: storeType
            },
            "dumping mempool"
        )
    }

    return {
        // Methods used for bundling
        popOutstanding: async (entryPoint: Address) => {
            const { outstanding } = getStoreHandlers(entryPoint)
            return await outstanding.pop()
        },
        peekOutstanding: async (entryPoint: Address) => {
            const { outstanding } = getStoreHandlers(entryPoint)
            return await outstanding.peek()
        },

        // State handling
        addOutstanding: async ({
            entryPoint,
            userOpInfo
        }: EntryPointUserOpInfoParam) => {
            const { outstanding } = getStoreHandlers(entryPoint)
            logAddOperation(userOpInfo.userOpHash, "outstanding")
            await outstanding.add(userOpInfo)
        },
        addProcessing: ({
            entryPoint,
            userOpInfo
        }: EntryPointUserOpInfoParam) => {
            const { processing } = getStoreHandlers(entryPoint)
            logAddOperation(userOpInfo.userOpHash, "processing")
            processing.add(userOpInfo)
            return Promise.resolve()
        },
        addSubmitted: ({
            entryPoint,
            submittedUserOp
        }: EntryPointSubmittedUserOpParam) => {
            const { submitted } = getStoreHandlers(entryPoint)
            logAddOperation(submittedUserOp.userOpHash, "submitted")
            submitted.add(submittedUserOp)
            return Promise.resolve()
        },
        removeOutstanding: async ({
            entryPoint,
            userOpHash
        }: EntryPointUserOpHashParam) => {
            const { outstanding } = getStoreHandlers(entryPoint)
            const removed = await outstanding.remove(userOpHash)
            logRemoveOperation(userOpHash, "outstanding", removed)
        },
        removeProcessing: async ({
            entryPoint,
            userOpHash
        }: EntryPointUserOpHashParam) => {
            const { processing } = getStoreHandlers(entryPoint)
            const removed = await processing.remove(userOpHash)
            logRemoveOperation(userOpHash, "processing", removed)
        },
        removeSubmitted: async ({
            entryPoint,
            userOpHash
        }: EntryPointUserOpHashParam) => {
            const { submitted } = getStoreHandlers(entryPoint)
            const removed = await submitted.remove(userOpHash)
            logRemoveOperation(userOpHash, "submitted", removed)
        },
        dumpOutstanding: async (entryPoint: Address) => {
            const { outstanding } = getStoreHandlers(entryPoint)
            logDumpOperation("outstanding")
            return await outstanding.dumpLocal()
        },
        dumpProcessing: async (entryPoint: Address) => {
            const { processing } = getStoreHandlers(entryPoint)
            logDumpOperation("processing")
            return await processing.dumpLocal()
        },
        dumpSubmitted: async (entryPoint: Address) => {
            const { submitted } = getStoreHandlers(entryPoint)
            logDumpOperation("submitted")
            return await submitted.dumpLocal()
        },

        // Check if the userOp is already in the mempool
        isInMempool: async ({
            userOpHash,
            entryPoint
        }: EntryPointUserOpHashParam) => {
            const { outstanding, processing, submitted } =
                getStoreHandlers(entryPoint)

            const [inOutstanding, inProcessing, inSubmitted] =
                await Promise.all([
                    outstanding.contains(userOpHash),
                    processing.contains(userOpHash),
                    submitted.contains(userOpHash)
                ])

            return inOutstanding || inProcessing || inSubmitted
        },

        validateSubmittedOrProcessing: async ({
            entryPoint,
            userOp
        }: { entryPoint: Address; userOp: UserOperation }) => {
            const { submitted, processing } = getStoreHandlers(entryPoint)

            const [submittedConflict, processingConflict] = await Promise.all([
                submitted.findConflicting(userOp),
                processing.findConflicting(userOp)
            ])

            const conflicting = submittedConflict || processingConflict

            if (conflicting?.reason === "conflicting_nonce") {
                return {
                    valid: false,
                    reason: "AA25 invalid account nonce: Another UserOperation with same sender and nonce is already being processed"
                }
            }

            if (conflicting?.reason === "conflicting_deployment") {
                return {
                    valid: false,
                    reason: "AA25 invalid account deployment: Another deployment operation for this sender is already being processed"
                }
            }

            return { valid: true }
        },

        popConflictingOustanding: async ({
            entryPoint,
            userOp
        }: { entryPoint: Address; userOp: UserOperation }) => {
            const { outstanding } = getStoreHandlers(entryPoint)
            return await outstanding.popConflicting(userOp)
        },

        validateSenderLimits: ({
            entryPoint,
            userOp
        }: { entryPoint: Address; userOp: UserOperation }) => {
            const { outstanding } = getStoreHandlers(entryPoint)

            if (!outstanding.validateParallelLimit(userOp)) {
                return Promise.resolve({
                    valid: false,
                    reason: "AA25 invalid account nonce: Maximum number of parallel user operations for that is allowed for this sender reached"
                })
            }

            if (!outstanding.validateQueuedLimit(userOp)) {
                return Promise.resolve({
                    valid: false,
                    reason: "AA25 invalid account nonce: Maximum number of queued user operations reached for this sender and nonce key"
                })
            }

            return Promise.resolve({ valid: true })
        },

        // misc
        getQueuedOutstandingUserOps: async ({
            userOp,
            entryPoint
        }: {
            userOp: UserOperation
            entryPoint: Address
        }) => {
            const { outstanding } = getStoreHandlers(entryPoint)
            return await outstanding.getQueuedUserOps(userOp)
        },
        clearOutstanding: async (entryPoint: Address) => {
            const { outstanding } = getStoreHandlers(entryPoint)
            await outstanding.clear()
            logger.debug({ store: "outstanding" }, "cleared mempool")
        }
    }
}
