import type { EventManager, GasPriceManager } from "@alto/handlers"
import type {
    InterfaceReputationManager,
    Mempool,
    Monitor
} from "@alto/mempool"
import {
    type BundlingMode,
    type SubmittedBundleInfo,
    UserOperationBundle
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import { Hex, type WatchBlocksReturnType } from "viem"
import type { Executor } from "./executor"
import type { AltoConfig } from "../createConfig"
import { SenderManager } from "./senderManager"
import { GasPriceParameters } from "@alto/types"
import { BundleMonitor } from "./bundleMonitor"

const SCALE_FACTOR = 10 // Interval increases by 10ms per task per minute
const RPM_WINDOW = 60000 // 1 minute window in ms

export class ExecutorManager {
    private senderManager: SenderManager
    private config: AltoConfig
    private executor: Executor
    private mempool: Mempool
    private logger: Logger
    private metrics: Metrics
    private gasPriceManager: GasPriceManager
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
        this.logger = config.getLogger(
            { module: "executor_manager" },
            {
                level: config.executorLogLevel || config.logLevel
            }
        )
        this.metrics = metrics
        this.gasPriceManager = gasPriceManager
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
            // Count total ops and add timestamps
            const totalOps = bundles.reduce(
                (sum, bundle) => sum + bundle.userOps.length,
                0
            )
            this.opsCount.push(...Array(totalOps).fill(Date.now()))
        }

        // Send bundles to executor
        for (const bundle of bundles) {
            this.sendBundleToExecutor(bundle)
        }

        const rpm = this.opsCount.length

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
            // Free executor if failed to get initial params.
            await this.senderManager.markWalletProcessed(wallet)
            await this.mempool.resubmitUserOps({
                userOps,
                entryPoint,
                reason: "Failed to get nonce and gas parameters for bundling"
            })
            return undefined
        }

        const bundleResult = await this.executor.bundle({
            executor: wallet,
            userOpBundle,
            networkGasPrice: gasPriceParams,
            networkBaseFee: baseFee,
            nonce
        })

        if (!bundleResult.success) {
            const { rejectedUserOps, recoverableOps, reason } = bundleResult
            // Free wallet as no bundle was sent.
            await this.senderManager.markWalletProcessed(wallet)

            // Drop rejected ops
            await this.mempool.dropUserOps(entryPoint, rejectedUserOps)
            this.metrics.userOperationsSubmitted
                .labels({ status: "failed" })
                .inc(rejectedUserOps.length)

            // Handle recoverable ops
            if (recoverableOps.length) {
                await this.mempool.resubmitUserOps({
                    userOps: recoverableOps,
                    entryPoint,
                    reason
                })
            }

            if (reason === "filterops_failed" || reason === "generic_error") {
                this.metrics.bundlesSubmitted.labels({ status: "failed" }).inc()
            }

            return undefined
        }

        // Success case
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

        const submittedBundle: SubmittedBundleInfo = {
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
            lastReplaced: Date.now()
        }

        this.bundleMonitor.setPendingBundle(submittedBundle)
        await this.mempool.markUserOpsAsSubmitted({
            userOps: submittedBundle.bundle.userOps,
            entryPoint: submittedBundle.bundle.entryPoint,
            transactionHash: submittedBundle.transactionHash
        })
        // Start watching blocks after marking operations as submitted
        this.startWatchingBlocks()
        await this.mempool.dropUserOps(entryPoint, rejectedUserOps)
        this.metrics.bundlesSubmitted.labels({ status: "success" }).inc()

        return transactionHash
    }

    stopWatchingBlocks(): void {
        if (this.unWatch) {
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
        const pendingBundles =
            await this.bundleMonitor.processBlock(blockNumber)

        if (pendingBundles.length === 0) {
            this.stopWatchingBlocks()
            this.currentlyHandlingBlock = false
            return
        }

        // for all still not included check if needs to be replaced (based on gas price)
        const [networkGasPrice, networkBaseFee] = await Promise.all([
            this.gasPriceManager.tryGetNetworkGasPrice().catch(() => ({
                maxFeePerGas: 0n,
                maxPriorityFeePerGas: 0n
            })),
            this.getBaseFee().catch(() => 0n)
        ])

        await Promise.all(
            pendingBundles.map(async (txInfo) => {
                const { transactionRequest } = txInfo

                const {
                    maxFeePerGas: txMaxFee,
                    maxPriorityFeePerGas: txMaxPriorityFee
                } = transactionRequest

                const {
                    maxFeePerGas: networkMaxFee,
                    maxPriorityFeePerGas: networkMaxPriorityFee
                } = networkGasPrice

                const isMaxFeeTooLow = txMaxFee < networkMaxFee

                const isPriorityFeeTooLow =
                    txMaxPriorityFee < networkMaxPriorityFee

                const isStuck =
                    Date.now() - txInfo.lastReplaced >
                    this.config.resubmitStuckTimeout

                if (isMaxFeeTooLow || isPriorityFeeTooLow) {
                    await this.replaceTransaction({
                        txInfo,
                        gasPriceParams: networkGasPrice,
                        networkBaseFee,
                        reason: "gas_price"
                    })
                } else if (isStuck) {
                    await this.replaceTransaction({
                        txInfo,
                        gasPriceParams: networkGasPrice,
                        networkBaseFee,
                        reason: "stuck"
                    })
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
        txInfo: SubmittedBundleInfo
        gasPriceParams: GasPriceParameters
        networkBaseFee: bigint
        reason: "gas_price" | "stuck"
    }): Promise<void> {
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

        // Handle case where no bundle was sent.
        if (!bundleResult.success) {
            // Free wallet as no bundle was sent.
            await this.senderManager.markWalletProcessed(txInfo.executor)
            const { rejectedUserOps, recoverableOps, reason } = bundleResult

            this.logger.warn(
                { oldTxHash, reason },
                "failed to replace transaction"
            )

            // Drop rejected ops
            await this.mempool.dropUserOps(entryPoint, rejectedUserOps)

            // Handle recoverable ops
            if (recoverableOps.length) {
                await this.mempool.resubmitUserOps({
                    userOps: recoverableOps,
                    entryPoint,
                    reason
                })
            }

            this.metrics.replacedTransactions
                .labels({ reason, status: "failed" })
                .inc()

            return
        }

        // Success case
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

        const newTxInfo: SubmittedBundleInfo = {
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

        // Replace existing submitted bundle with new one
        this.bundleMonitor.setPendingBundle(newTxInfo)

        // Drop all userOperations that were rejected during simulation.
        await this.mempool.dropUserOps(entryPoint, rejectedUserOps)

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
}
