import {
    UserOperation,
    type HexData32,
    type SubmittedUserOp,
    type UserOpInfo
} from "@alto/types"
import { isVersion06, isVersion07, type Metrics } from "@alto/utils"
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
                config,
                entryPoint
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

    const logDumpOperation = async (storeType: StoreType) => {
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

        // State handling
        addOutstanding: async ({
            entryPoint,
            userOpInfo
        }: EntryPointUserOpInfoParam) => {
            const outstanding = storeHandlers.get(entryPoint)?.outstanding
            if (!outstanding) {
                throw new Error("unexpected error")
            }

            logAddOperation(userOpInfo.userOpHash, "outstanding")
            await outstanding.add(userOpInfo)
        },
        addProcessing: async ({
            entryPoint,
            userOpInfo
        }: EntryPointUserOpInfoParam) => {
            const processing = storeHandlers.get(entryPoint)?.processing
            if (!processing) {
                throw new Error("unexpected error")
            }

            logAddOperation(userOpInfo.userOpHash, "processing")
            processing.add(userOpInfo)
        },
        addSubmitted: async ({
            entryPoint,
            submittedUserOp
        }: EntryPointSubmittedUserOpParam) => {
            const submitted = storeHandlers.get(entryPoint)?.submitted
            if (!submitted) {
                throw new Error("unexpected error")
            }

            logAddOperation(submittedUserOp.userOpHash, "submitted")
            submitted.add(submittedUserOp)
        },
        removeOutstanding: async ({
            entryPoint,
            userOpHash
        }: EntryPointUserOpHashParam) => {
            const outstanding = storeHandlers.get(entryPoint)?.outstanding
            if (!outstanding) {
                throw new Error("unexpected error")
            }

            const removed = await outstanding.remove(userOpHash)
            logRemoveOperation(userOpHash, "outstanding", removed)
        },
        removeProcessing: async ({
            entryPoint,
            userOpHash
        }: EntryPointUserOpHashParam) => {
            const processing = storeHandlers.get(entryPoint)?.processing
            if (!processing) {
                throw new Error("unexpected error")
            }

            const removed = await processing.remove(userOpHash)
            logRemoveOperation(userOpHash, "processing", removed)
        },
        removeSubmitted: async ({
            entryPoint,
            userOpHash
        }: EntryPointUserOpHashParam) => {
            const submitted = storeHandlers.get(entryPoint)?.submitted
            if (!submitted) {
                throw new Error("unexpected error")
            }

            const removed = await submitted.remove(userOpHash)
            logRemoveOperation(userOpHash, "submitted", removed)
        },
        dumpOutstanding: async (entryPoint: Address) => {
            const outstanding = storeHandlers.get(entryPoint)?.outstanding
            if (!outstanding) {
                throw new Error("unexpected error")
            }

            await logDumpOperation("outstanding")
            return await outstanding.dump()
        },
        dumpProcessing: async (entryPoint: Address) => {
            const processing = storeHandlers.get(entryPoint)?.processing
            if (!processing) {
                throw new Error("unexpected error")
            }

            await logDumpOperation("processing")
            return await processing.dump()
        },
        dumpSubmitted: async (entryPoint: Address) => {
            const submitted = storeHandlers.get(entryPoint)?.submitted
            if (!submitted) {
                throw new Error("unexpected error")
            }

            await logDumpOperation("submitted")
            return await submitted.dump()
        },

        // Check if the userOp is already in the mempool
        isInMempool: async ({
            userOpHash,
            entryPoint
        }: EntryPointUserOpHashParam) => {
            const stores = storeHandlers.get(entryPoint)
            if (!stores) {
                throw new Error("unexpected error")
            }

            const { outstanding, processing, submitted } = stores

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
            const stores = storeHandlers.get(entryPoint)
            if (!stores) {
                throw new Error("unexpected error")
            }

            const { submitted, processing } = stores
            const { sender, nonce } = userOp

            const processedOrSubmittedOps = [
                ...(await submitted.dump()),
                ...(await processing.dump())
            ]

            // Check for same sender and nonce
            const hasSameNonce = processedOrSubmittedOps.some((userOpInfo) => {
                const { userOp: mempoolUserOp } = userOpInfo
                return (
                    mempoolUserOp.sender === sender &&
                    mempoolUserOp.nonce === nonce
                )
            })

            if (hasSameNonce) {
                return {
                    valid: false,
                    reason: "AA25 invalid account nonce: Another UserOperation with same sender and nonce is already being processed"
                }
            }

            // Check for deployment conflict
            const isCurrentOpDeployment =
                (isVersion06(userOp) &&
                    userOp.initCode &&
                    userOp.initCode !== "0x") ||
                (isVersion07(userOp) &&
                    userOp.factory &&
                    userOp.factory !== "0x")

            if (isCurrentOpDeployment) {
                const hasDeploymentConflict = processedOrSubmittedOps.some(
                    (userOpInfo) => {
                        const { userOp: mempoolUserOp } = userOpInfo

                        const isV6Deployment =
                            isVersion06(mempoolUserOp) &&
                            mempoolUserOp.initCode &&
                            mempoolUserOp.initCode !== "0x"

                        const isV7Deployment =
                            isVersion07(mempoolUserOp) &&
                            mempoolUserOp.factory &&
                            mempoolUserOp.factory !== "0x"

                        const isDeployment = isV6Deployment || isV7Deployment

                        return mempoolUserOp.sender === sender && isDeployment
                    }
                )

                if (hasDeploymentConflict) {
                    return {
                        valid: false,
                        reason: "AA25 invalid account deployment: Another deployment operation for this sender is already being processed"
                    }
                }
            }

            return { valid: true }
        },
        // Conditions for when a old_user_op can be replaced from outstanding store
        // - old_user_op with same sender and nonce exists such that:
        //   - new_user_op has maxFeePerGas and maxPriorityFeePerGas >10% of old_user_op
        // - old_user_op with same sender and factoryData such that:
        //   - new_user_op has maxFeePerGas and maxPriorityFeePerGas >10% of old_user_op
        findConflictingOutstanding: async ({
            entryPoint,
            userOp
        }: { entryPoint: Address; userOp: UserOperation }) => {
            throw new Error("Method not implemented.")
        },

        validateSenderLimits: async ({
            entryPoint,
            userOp
        }: { entryPoint: Address; userOp: UserOperation }) => {
            const stores = storeHandlers.get(entryPoint)
            if (!stores) {
                throw new Error("unexpected error")
            }

            const { outstanding } = stores

            if (!outstanding.validateParallelLimit(userOp)) {
                return {
                    valid: false,
                    reason: "AA25 invalid account nonce: Maximum number of parallel user operations for that is allowed for this sender reached"
                }
            }

            if (!outstanding.validateQueuedLimit(userOp)) {
                return {
                    valid: false,
                    reason: "AA25 invalid account nonce: Maximum number of queued user operations reached for this sender and nonce key"
                }
            }

            return { valid: true }
        },

        // misc
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
