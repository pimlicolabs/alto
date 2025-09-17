import type { HexData32, UserOperation } from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Logger } from "@alto/utils"
import * as sentry from "@sentry/node"
import type { Address } from "viem"
import type {
    EntryPointUserOpHashParam,
    EntryPointUserOpInfoParam,
    MempoolStore,
    OutstandingStore,
    StoreType
} from "."
import type { AltoConfig } from "../createConfig"
import { createMemoryOutstandingQueue } from "./createMemoryOutstandingStore"
import {
    type ProcessingStore,
    createProcessingStore
} from "./createProcessingStore"
import { createRedisOutstandingQueue } from "./createRedisOutstandingStore"

export const createMempoolStore = ({
    config,
    metrics
}: { config: AltoConfig; metrics: Metrics }): MempoolStore => {
    const logger: Logger = config.getLogger(
        { module: "mempool-store" },
        {
            level: config.logLevel
        }
    )

    const storeHandlers: Map<
        Address,
        {
            outstanding: OutstandingStore
            processing: ProcessingStore
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

        if (config.enableHorizontalScaling && config.redisEndpoint) {
            outstanding = createRedisOutstandingQueue({
                config,
                entryPoint,
                redisEndpoint: config.redisEndpoint,
                logger
            })
        } else {
            outstanding = createMemoryOutstandingQueue({
                config,
                logger
            })
        }

        const processing = createProcessingStore({
            config,
            entryPoint
        })

        storeHandlers.set(entryPoint, {
            outstanding,
            processing
        })
    }

    const logAddOperation = (userOpHash: HexData32, storeType: StoreType) => {
        logger.debug(
            { userOpHash, store: storeType },
            `added user op to ${storeType} mempool`
        )
        metrics.userOpsInMempool.labels({ status: storeType }).inc()
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

        metrics.userOpsInMempool.labels({ status: storeType }).dec()
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
            try {
                const { outstanding } = getStoreHandlers(entryPoint)
                return await outstanding.pop()
            } catch (err) {
                logger.error(
                    { err },
                    "Failed to pop from outstanding mempool, defaulting to undefined"
                )
                sentry.captureException(err)
                return undefined
            }
        },

        // State handling
        addOutstanding: async ({
            entryPoint,
            userOpInfo
        }: EntryPointUserOpInfoParam) => {
            const { outstanding } = getStoreHandlers(entryPoint)
            logAddOperation(userOpInfo.userOpHash, "outstanding")
            try {
                await outstanding.add(userOpInfo)
            } catch (err) {
                logger.error({ err }, "Failed to add to outstanding mempool")
                sentry.captureException(err)
            }
        },
        removeOutstanding: async ({
            entryPoint,
            userOpHash
        }: EntryPointUserOpHashParam) => {
            try {
                const { outstanding } = getStoreHandlers(entryPoint)
                const removed = await outstanding.remove(userOpHash)
                logRemoveOperation(userOpHash, "outstanding", removed)
            } catch (err) {
                logger.error(
                    { err },
                    "Failed to remove from outstanding mempool"
                )
                sentry.captureException(err)
                return Promise.resolve()
            }
        },
        dumpOutstanding: async (entryPoint: Address) => {
            const { outstanding } = getStoreHandlers(entryPoint)
            logDumpOperation("outstanding")
            return await outstanding.dumpLocal()
        },

        // Methods to mark/unmark userOps that are being processed.
        registerProcessing: async ({
            entryPoint,
            userOpInfo
        }: EntryPointUserOpInfoParam) => {
            try {
                const { processing } = getStoreHandlers(entryPoint)
                const { userOp } = userOpInfo

                await processing.startProcessing(userOp)
            } catch (err) {
                logger.error({ err }, "Failed to track active operation")
                sentry.captureException(err)
            }
        },
        unregisterProcessing: async ({
            entryPoint,
            userOpHash
        }: EntryPointUserOpHashParam) => {
            try {
                const { processing } = getStoreHandlers(entryPoint)
                await processing.finishProcessing(userOpHash)
            } catch (err) {
                logger.error({ err }, "Failed to untrack active operation")
                sentry.captureException(err)
            }
        },

        // Check if the userOp is already in the mempool or conflicts with existing operations
        checkDuplicatesAndConflicts: async ({
            entryPoint,
            userOp,
            userOpHash
        }: {
            entryPoint: Address
            userOp: UserOperation
            userOpHash: HexData32
        }) => {
            const { outstanding, processing } = getStoreHandlers(entryPoint)

            // Run all checks in parallel for better performance
            const [isInOutstanding, isInProcessing, conflict] =
                await Promise.all([
                    outstanding.contains(userOpHash),
                    processing.isProcessing(userOpHash),
                    processing.findConflict(userOp)
                ])

            // Check if already known (in outstanding or processing)
            if (isInOutstanding || isInProcessing) {
                return {
                    valid: false,
                    reason: "Already known"
                }
            }

            if (conflict?.reason === "nonce_conflict") {
                return {
                    valid: false,
                    reason: "AA25 invalid account nonce: Another UserOperation with same sender and nonce is already being processed"
                }
            }

            if (conflict?.reason === "deployment_conflict") {
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
            try {
                const { outstanding } = getStoreHandlers(entryPoint)
                return await outstanding.popConflicting(userOp)
            } catch (err) {
                logger.error(
                    { err },
                    "Failed to popConflicting from outstanding mempool, defaulting to undefined"
                )
                sentry.captureException(err)
                return undefined
            }
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
