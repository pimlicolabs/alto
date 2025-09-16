import type { HexData32, UserOperation } from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Logger } from "@alto/utils"
import * as sentry from "@sentry/node"
import type { Address } from "viem"
import type {
    EntryPointUserOpHashParam,
    EntryPointUserOpInfoParam,
    MempoolStore,
    StoreType
} from "."
import type { AltoConfig } from "../createConfig"
import {
    createMemoryOutstandingQueue,
    createRedisOutstandingQueue,
    OutstandingStore
} from "./outstanding"

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
                redisEndpoint: config.redisEndpoint
            })

            // Log the Redis keys being used
            const outstandingKey = `${config.chainId}:${entryPoint}:outstanding:pending-queue`
            const processingKey = `${config.chainId}:${entryPoint}:processing`
            const submittedKey = `${config.chainId}:${entryPoint}:submitted`

            logger.info(
                {
                    outstandingKey,
                    processingKey,
                    submittedKey
                },
                "Using redis for outstanding, processing, submitted mempools with keys"
            )
        } else {
            outstanding = createMemoryOutstandingQueue({
                config
            })
            logger.info(
                "Using memory for outstanding, processing, submitted mempools"
            )
        }

        storeHandlers.set(entryPoint, {
            outstanding
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
            //const { outstanding } = getStoreHandlers(entryPoint)
            //logDumpOperation("outstanding")
            //return await outstanding.dumpLocal()
            return []
        },
        dumpProcessing: async (entryPoint: Address) => {
            //const { processing } = getStoreHandlers(entryPoint)
            //logDumpOperation("processing")
            //return await processing.dumpLocal()
            return []
        },
        dumpSubmitted: async (entryPoint: Address) => {
            //const { submitted } = getStoreHandlers(entryPoint)
            //logDumpOperation("submitted")
            //return await submitted.dumpLocal()
            return []
        },

        // Check for mempool conflicts (duplicate hash or conflicting nonce/deployment)
        checkMempoolConflicts: async ({
            userOpHash,
            entryPoint,
            userOp
        }: {
            userOpHash: HexData32
            entryPoint: Address
            userOp: UserOperation
        }) => {
            const { outstanding } = getStoreHandlers(entryPoint)

            // First check if exact userOpHash already exists
            const [inOutstanding] = await Promise.all([
                outstanding.contains(userOpHash)
            ])

            if (inOutstanding) {
                return {
                    valid: false,
                    reason: "Already known"
                }
            }

            // Then check for conflicting operations (same nonce or deployment)
            //const [submittedConflict, processingConflict] = await Promise.all([
            //    submitted.findConflicting(userOp),
            //    processing.findConflicting(userOp)
            //])

            //const conflicting = submittedConflict || processingConflict

            //if (conflicting?.reason === "conflicting_nonce") {
            //    return {
            //        valid: false,
            //        reason: "AA25 invalid account nonce: Another UserOperation with same sender and nonce is already being processed"
            //    }
            //}

            //if (conflicting?.reason === "conflicting_deployment") {
            //    return {
            //        valid: false,
            //        reason: "AA25 invalid account deployment: Another deployment operation for this sender is already being processed"
            //    }
            //}

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
