import type { EventManager, GasPriceManager } from "@alto/handlers"
import type {
    InterfaceReputationManager,
    Mempool,
    Monitor
} from "@alto/mempool"
import {
    type BundlingMode,
    type TransactionInfo,
    RejectedUserOp,
    UserOperationBundle,
    UserOpInfo
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import { getAAError, jsonStringifyWithBigint } from "@alto/utils"
import {
    type Address,
    type Hash,
    Hex,
    NonceTooLowError,
    type WatchBlocksReturnType
} from "viem"
import type { Executor } from "./executor"
import type { AltoConfig } from "../createConfig"
import { SenderManager } from "./senderManager"
import { BaseError } from "abitype"
import { getUserOpHashes } from "./utils"
import { GasPriceParameters } from "@alto/types"
import { BundleMonitor } from "./bundleMonitor"

const SCALE_FACTOR = 10 // Interval increases by 10ms per task per minute
const RPM_WINDOW = 60000 // 1 minute window in ms

export class ExecutorManager {
    private senderManager: SenderManager
    private config: AltoConfig
    private executor: Executor
    private mempool: Mempool
    private monitor: Monitor
    private logger: Logger
    private metrics: Metrics
    private gasPriceManager: GasPriceManager
    private eventManager: EventManager
    private opsCount: number[] = []
    private bundlingMode: BundlingMode
    private bundleMonitor: BundleMonitor
    private unWatch: WatchBlocksReturnType | undefined

    private currentlyHandlingBlock = false

    constructor({
        config,
        executor,
        mempool,
        monitor,
        reputationManager,
        metrics,
        gasPriceManager,
        eventManager,
        senderManager
    }: {
        config: AltoConfig
        executor: Executor
        mempool: Mempool
        monitor: Monitor
        reputationManager: InterfaceReputationManager
        metrics: Metrics
        gasPriceManager: GasPriceManager
        eventManager: EventManager
        senderManager: SenderManager
    }) {
        this.config = config
        this.executor = executor
        this.mempool = mempool
        this.monitor = monitor
        this.logger = config.getLogger(
            { module: "executor_manager" },
            {
                level: config.executorLogLevel || config.logLevel
            }
        )
        this.metrics = metrics
        this.gasPriceManager = gasPriceManager
        this.eventManager = eventManager
        this.senderManager = senderManager

        this.bundleMonitor = new BundleMonitor({
            config,
            mempool,
            monitor,
            metrics,
            eventManager,
            senderManager,
            reputationManager
        })

        this.bundlingMode = this.config.bundleMode

        if (this.bundlingMode === "auto") {
            this.autoScalingBundling()
        }
    }

    async setBundlingMode(bundleMode: BundlingMode): Promise<void> {
        this.bundlingMode = bundleMode

        if (bundleMode === "manual") {
            await new Promise((resolve) =>
                setTimeout(resolve, 2 * this.config.maxBundleInterval)
            )
        }

        if (bundleMode === "auto") {
            this.autoScalingBundling()
        }
    }

    autoScalingBundling = async () => {
        const now = Date.now()
        this.opsCount = this.opsCount.filter(
            (timestamp) => now - timestamp < RPM_WINDOW
        )

        const bundles = await this.mempool.getBundles()

        if (bundles.length > 0) {
            const opsCount: number = bundles
                .map(({ userOps }) => userOps.length)
                .reduce((a, b) => a + b)

            // Add timestamps for each task
            const timestamp = Date.now()
            this.opsCount.push(...Array(opsCount).fill(timestamp))

            // Send bundles to executor
            bundles.map((bundle) => this.sendBundleToExecutor(bundle))
        }

        const rpm: number = this.opsCount.length
        // Calculate next interval with linear scaling
        const nextInterval: number = Math.min(
            this.config.minBundleInterval + rpm * SCALE_FACTOR, // Linear scaling
            this.config.maxBundleInterval // Cap at configured max interval
        )

        if (this.bundlingMode === "auto") {
            setTimeout(this.autoScalingBundling, nextInterval)
        }
    }

    startWatchingBlocks(): void {
        if (this.unWatch) {
            return
        }

        this.unWatch = this.config.publicClient.watchBlockNumber({
            onBlockNumber: async (blockNumber) => {
                await this.handleBlock(blockNumber)
            },
            onError: (error) => {
                this.logger.error({ error }, "error while watching blocks")
            },
            emitMissed: false,
            pollingInterval: this.config.pollingInterval
        })

        this.logger.debug("started watching blocks")
    }

    // Debug endpoint
    async sendBundleNow(): Promise<Hash | undefined> {
        const bundles = await this.mempool.getBundles(1)
        const bundle = bundles[0]

        if (bundles.length === 0 || bundle.userOps.length === 0) {
            return
        }

        const txHash = await this.sendBundleToExecutor(bundle)

        if (!txHash) {
            throw new Error("no tx hash")
        }

        return txHash
    }

    async getBaseFee(): Promise<bigint> {
        if (this.config.legacyTransactions) {
            return 0n
        }
        return await this.gasPriceManager.getBaseFee()
    }

    async sendBundleToExecutor(
        userOpBundle: UserOperationBundle
    ): Promise<Hex | undefined> {
        const { entryPoint, userOps, version } = userOpBundle
        if (userOps.length === 0) {
            return undefined
        }

        const wallet = await this.senderManager.getWallet()

        const [gasPriceParams, baseFee, nonce] = await Promise.all([
            this.gasPriceManager.tryGetNetworkGasPrice(),
            this.getBaseFee(),
            this.config.publicClient.getTransactionCount({
                address: wallet.address,
                blockTag: "latest"
            })
        ]).catch((_) => {
            return []
        })

        if (!gasPriceParams || nonce === undefined) {
            await this.resubmitUserOperations(
                userOps,
                entryPoint,
                "Failed to get nonce and gas parameters for bundling"
            )
            // Free executor if failed to get initial params.
            await this.senderManager.markWalletProcessed(wallet)
            return undefined
        }

        const bundleResult = await this.executor.bundle({
            executor: wallet,
            userOpBundle,
            networkGasPrice: gasPriceParams,
            networkBaseFee: baseFee,
            nonce
        })

        // Free wallet if no bundle was sent.
        if (bundleResult.status !== "submission_success") {
            await this.senderManager.markWalletProcessed(wallet)
        }

        // All ops failed simulation, drop them and return.
        if (bundleResult.status === "filterops_all_rejected") {
            const { rejectedUserOps } = bundleResult
            await this.dropUserOps(entryPoint, rejectedUserOps)
            return undefined
        }

        // Unhandled error during simulation, drop all ops.
        if (bundleResult.status === "filterops_unhandled_error") {
            const rejectedUserOps = userOps.map((userOp) => ({
                ...userOp,
                reason: "filterOps simulation error"
            }))
            await this.dropUserOps(entryPoint, rejectedUserOps)
            this.metrics.bundlesSubmitted.labels({ status: "failed" }).inc()
            return undefined
        }

        // Resubmit if executor has insufficient funds.
        if (bundleResult.status === "submission_insufficient_funds_error") {
            const { userOpsToBundle, rejectedUserOps } = bundleResult
            await this.dropUserOps(entryPoint, rejectedUserOps)
            await this.resubmitUserOperations(
                userOpsToBundle,
                entryPoint,
                "Executor has insufficient funds"
            )
            this.metrics.bundlesSubmitted.labels({ status: "resubmit" }).inc()
            return undefined
        }

        // Encountered unhandled error during bundle submission.
        if (bundleResult.status === "submission_generic_error") {
            const { rejectedUserOps, userOpsToBundle, reason } = bundleResult
            await this.dropUserOps(entryPoint, rejectedUserOps)
            // NOTE: these ops passed validation, so we can try resubmitting them
            await this.resubmitUserOperations(
                userOpsToBundle,
                entryPoint,
                reason instanceof BaseError
                    ? reason.name
                    : "Encountered unhandled error during bundle submission"
            )
            this.metrics.bundlesSubmitted.labels({ status: "failed" }).inc()
            return undefined
        }

        if (bundleResult.status === "submission_success") {
            let {
                userOpsBundled,
                rejectedUserOps,
                transactionRequest,
                transactionHash
            } = bundleResult

            // Increment submission attempts for all userOps submitted.
            userOpsBundled = userOpsBundled.map((userOpInfo) => ({
                ...userOpInfo,
                submissionAttempts: userOpInfo.submissionAttempts + 1
            }))

            const transactionInfo: TransactionInfo = {
                executor: wallet,
                transactionHash,
                transactionRequest,
                bundle: {
                    entryPoint,
                    version,
                    userOps: userOpsBundled,
                    submissionAttempts: 1
                },
                previousTransactionHashes: [],
                lastReplaced: Date.now(),
                timesPotentiallyIncluded: 0
            }

            await this.markUserOperationsAsSubmitted(
                userOpsBundled,
                transactionInfo
            )
            await this.dropUserOps(entryPoint, rejectedUserOps)
            this.metrics.bundlesSubmitted.labels({ status: "success" }).inc()

            return transactionHash
        }

        return undefined
    }

    stopWatchingBlocks(): void {
        if (this.unWatch) {
            this.logger.debug("stopped watching blocks")
            this.unWatch()
            this.unWatch = undefined
        }
    }

    private async handleBlock(blockNumber: bigint) {
        if (this.currentlyHandlingBlock) {
            return
        }
        this.currentlyHandlingBlock = true

        // Process the block and get the results
        const result = await this.bundleMonitor.processBlock(blockNumber)

        if (!result.hasSubmittedEntries) {
            this.stopWatchingBlocks()
            this.currentlyHandlingBlock = false
            return
        }

        // for all still not included check if needs to be replaced (based on gas price)
        const [gasPriceParams, networkBaseFee] = await Promise.all([
            this.gasPriceManager.tryGetNetworkGasPrice().catch(() => ({
                maxFeePerGas: 0n,
                maxPriorityFeePerGas: 0n
            })),
            this.getBaseFee().catch(() => 0n)
        ])

        // Use the submitted transactions from the result
        const transactionInfos = result.submittedTransactions

        await Promise.all(
            transactionInfos.map(async (txInfo) => {
                const { transactionRequest } = txInfo
                const { maxFeePerGas, maxPriorityFeePerGas } =
                    transactionRequest

                const isMaxFeeTooLow =
                    maxFeePerGas < gasPriceParams.maxFeePerGas

                const isPriorityFeeTooLow =
                    maxPriorityFeePerGas < gasPriceParams.maxPriorityFeePerGas

                const isStuck =
                    Date.now() - txInfo.lastReplaced >
                    this.config.resubmitStuckTimeout

                if (isMaxFeeTooLow || isPriorityFeeTooLow) {
                    await this.replaceTransaction({
                        txInfo,
                        gasPriceParams,
                        networkBaseFee,
                        reason: "gas_price"
                    })
                    return
                }

                if (isStuck) {
                    await this.replaceTransaction({
                        txInfo,
                        gasPriceParams,
                        networkBaseFee,
                        reason: "stuck"
                    })
                    return
                }
            })
        )

        this.currentlyHandlingBlock = false
    }

    async replaceTransaction({
        txInfo,
        gasPriceParams,
        networkBaseFee,
        reason
    }: {
        txInfo: TransactionInfo
        gasPriceParams: GasPriceParameters
        networkBaseFee: bigint
        reason: "gas_price" | "stuck"
    }): Promise<void> {
        // Setup vars
        const {
            bundle,
            executor,
            transactionRequest,
            transactionHash: oldTxHash
        } = txInfo
        const { entryPoint } = bundle

        const bundleResult = await this.executor.bundle({
            executor: executor,
            networkGasPrice: gasPriceParams,
            networkBaseFee,
            userOpBundle: bundle,
            nonce: transactionRequest.nonce
        })

        // Free wallet and return if potentially included too many times.
        if (txInfo.timesPotentiallyIncluded >= 3) {
            await this.removeUserOpsFromMempool(entryPoint, bundle.userOps)
            this.logger.warn(
                {
                    oldTxHash,
                    userOps: getUserOpHashes(bundleResult.rejectedUserOps)
                },
                "transaction potentially already included too many times, removing"
            )

            await this.senderManager.markWalletProcessed(txInfo.executor)
            return
        }

        // Free wallet if no bundle was sent or potentially included.
        if (bundleResult.status !== "submission_success") {
            await this.senderManager.markWalletProcessed(txInfo.executor)
        }

        // Check if the transaction is potentially included.
        const nonceTooLow =
            bundleResult.status === "submission_generic_error" &&
            bundleResult.reason instanceof NonceTooLowError

        const onchainConflict =
            bundleResult.status === "filterops_all_rejected" &&
            bundleResult.rejectedUserOps.every(
                ({ reason }) =>
                    reason === "AA25 invalid account nonce" ||
                    reason === "AA10 sender already constructed"
            )

        const potentiallyIncluded = nonceTooLow || onchainConflict

        // log metrics
        const replaceStatus = (() => {
            switch (true) {
                case potentiallyIncluded:
                    return "potentially_already_included"
                case bundleResult?.status === "submission_success":
                    return "replaced"
                default:
                    return "failed"
            }
        })()
        this.metrics.replacedTransactions
            .labels({ reason, status: replaceStatus })
            .inc()

        if (potentiallyIncluded) {
            this.logger.info(
                {
                    oldTxHash,
                    userOpHashes: getUserOpHashes(bundleResult.rejectedUserOps)
                },
                "transaction potentially already included"
            )
            txInfo.timesPotentiallyIncluded += 1
            return
        }

        if (bundleResult.status === "filterops_unhandled_error") {
            const { rejectedUserOps } = bundleResult
            await this.failedToReplaceTransaction({
                entryPoint,
                oldTxHash,
                reason: "filterOps simulation error",
                rejectedUserOps
            })
            return
        }

        if (bundleResult.status === "filterops_all_rejected") {
            await this.failedToReplaceTransaction({
                entryPoint,
                oldTxHash,
                reason: "all ops failed simulation",
                rejectedUserOps: bundleResult.rejectedUserOps
            })
            return
        }

        if (bundleResult.status === "submission_generic_error") {
            const { reason, rejectedUserOps } = bundleResult
            const submissionFailureReason =
                reason instanceof BaseError ? reason.name : "INTERNAL FAILURE"

            await this.failedToReplaceTransaction({
                oldTxHash,
                rejectedUserOps,
                reason: submissionFailureReason,
                entryPoint
            })
            return
        }

        if (bundleResult.status === "submission_insufficient_funds_error") {
            const { userOpsToBundle, rejectedUserOps } = bundleResult
            await this.dropUserOps(entryPoint, rejectedUserOps)
            await this.resubmitUserOperations(
                userOpsToBundle,
                entryPoint,
                "Executor has insufficient funds"
            )
            this.metrics.bundlesSubmitted.labels({ status: "resubmit" }).inc()
            return
        }

        const {
            rejectedUserOps,
            userOpsBundled,
            transactionRequest: newTransactionRequest,
            transactionHash: newTxHash
        } = bundleResult

        // Increment submission attempts for all replaced userOps
        const userOpsReplaced = userOpsBundled.map((userOpInfo) => ({
            ...userOpInfo,
            submissionAttempts: userOpInfo.submissionAttempts + 1
        }))

        const newTxInfo: TransactionInfo = {
            ...txInfo,
            transactionRequest: newTransactionRequest,
            transactionHash: newTxHash,
            previousTransactionHashes: [
                txInfo.transactionHash,
                ...txInfo.previousTransactionHashes
            ],
            lastReplaced: Date.now(),
            bundle: {
                ...bundle,
                userOps: userOpsReplaced,
                submissionAttempts: bundle.submissionAttempts + 1
            }
        }

        await this.markUserOperationsAsReplaced(userOpsReplaced, newTxInfo)

        // Drop all userOperations that were rejected during simulation.
        await this.dropUserOps(entryPoint, rejectedUserOps)

        this.logger.info(
            {
                oldTxHash,
                newTxHash,
                reason
            },
            "replaced transaction"
        )

        return
    }

    async markUserOperationsAsReplaced(
        userOpsReplaced: UserOpInfo[],
        newTxInfo: TransactionInfo
    ) {
        // Mark as replaced in mempool
        await Promise.all(
            userOpsReplaced.map(async (userOpInfo) => {
                await this.mempool.replaceSubmitted({
                    userOpInfo,
                    transactionInfo: newTxInfo
                })
            })
        )
    }

    async markUserOperationsAsSubmitted(
        userOpInfos: UserOpInfo[],
        transactionInfo: TransactionInfo
    ) {
        await Promise.all(
            userOpInfos.map(async (userOpInfo) => {
                const { userOpHash } = userOpInfo
                await this.mempool.markSubmitted({
                    userOpHash,
                    transactionInfo
                })
                this.metrics.userOperationsSubmitted
                    .labels({ status: "success" })
                    .inc()
            })
        )
        // Start watching blocks after marking operations as submitted
        this.startWatchingBlocks()
    }

    async resubmitUserOperations(
        userOps: UserOpInfo[],
        entryPoint: Address,
        reason: string
    ) {
        await Promise.all(
            userOps.map(async (userOpInfo) => {
                const { userOpHash, userOp } = userOpInfo
                this.logger.warn(
                    {
                        userOpHash,
                        reason
                    },
                    "resubmitting user operation"
                )
                await this.mempool.removeProcessing({ entryPoint, userOpHash })
                await this.mempool.add(userOp, entryPoint)
                this.metrics.userOperationsResubmitted.inc()
            })
        )
    }

    async failedToReplaceTransaction({
        oldTxHash,
        rejectedUserOps,
        reason,
        entryPoint
    }: {
        oldTxHash: Hex
        rejectedUserOps: RejectedUserOp[]
        reason: string
        entryPoint: Address
    }) {
        this.logger.warn({ oldTxHash, reason }, "failed to replace transaction")
        await this.dropUserOps(entryPoint, rejectedUserOps)
    }

    private async removeUserOpsFromMempool(
        entryPoint: Address,
        userOps: UserOpInfo[]
    ) {
        await Promise.all(
            userOps.map(async (userOpInfo) => {
                const { userOpHash } = userOpInfo
                await this.mempool.removeSubmitted({ entryPoint, userOpHash })
            })
        )
    }

    async dropUserOps(entryPoint: Address, rejectedUserOps: RejectedUserOp[]) {
        await Promise.all(
            rejectedUserOps.map(async (rejectedUserOp) => {
                const { userOp, reason, userOpHash } = rejectedUserOp
                await this.mempool.removeProcessing({ entryPoint, userOpHash })
                await this.mempool.removeSubmitted({ entryPoint, userOpHash })
                this.eventManager.emitDropped(
                    userOpHash,
                    reason,
                    getAAError(reason)
                )
                await this.monitor.setUserOperationStatus(userOpHash, {
                    status: "rejected",
                    transactionHash: null
                })
                this.logger.warn(
                    {
                        userOperation: jsonStringifyWithBigint(userOp),
                        userOpHash,
                        reason
                    },
                    "user operation rejected"
                )
                this.metrics.userOperationsSubmitted
                    .labels({ status: "failed" })
                    .inc()
            })
        )
    }
}
