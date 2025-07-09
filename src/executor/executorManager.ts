import type { GasPriceManager } from "@alto/handlers"
import type { Mempool } from "@alto/mempool"
import type {
    BundlingMode,
    SubmittedBundleInfo,
    UserOperationBundle
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import type { Hex, WatchBlocksReturnType } from "viem"
import type { Executor } from "./executor"
import type { AltoConfig } from "../createConfig"
import type { SenderManager } from "./senderManager"
import type { GasPriceParameters } from "@alto/types"
import type { UserOpMonitor } from "./userOpMonitor"

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
    private userOpMonitor: UserOpMonitor
    private unWatch: WatchBlocksReturnType | undefined

    private currentlyHandlingBlock = false

    constructor({
        config,
        executor,
        mempool,
        metrics,
        gasPriceManager,
        senderManager,
        userOpMonitor
    }: {
        config: AltoConfig
        executor: Executor
        mempool: Mempool
        metrics: Metrics
        gasPriceManager: GasPriceManager
        senderManager: SenderManager
        userOpMonitor: UserOpMonitor
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
        this.bundlingMode = this.config.bundleMode
        this.userOpMonitor = userOpMonitor

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

    async autoScalingBundling() {
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
            setTimeout(this.autoScalingBundling.bind(this), nextInterval)
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
            this.metrics.userOpsSubmitted
                .labels({ status: "failed" })
                .inc(rejectedUserOps.length)

            // Handle recoverable ops
            if (recoverableOps.length > 0) {
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

        this.userOpMonitor.trackBundle(submittedBundle)
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
            await this.userOpMonitor.processBlock(blockNumber)

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
            pendingBundles.map(async (submittedBundle) => {
                const { transactionRequest, lastReplaced } = submittedBundle
                const { maxFeePerGas, maxPriorityFeePerGas } =
                    transactionRequest

                const isGasPriceTooLow =
                    maxFeePerGas < networkGasPrice.maxFeePerGas ||
                    maxPriorityFeePerGas < networkGasPrice.maxPriorityFeePerGas

                const isStuck =
                    Date.now() - lastReplaced > this.config.resubmitStuckTimeout

                if (isGasPriceTooLow) {
                    await this.replaceTransaction({
                        submittedBundle,
                        networkGasPrice,
                        networkBaseFee,
                        reason: "gas_price"
                    })
                } else if (isStuck) {
                    await this.replaceTransaction({
                        submittedBundle,
                        networkGasPrice,
                        networkBaseFee,
                        reason: "stuck"
                    })
                }
            })
        )

        this.userOpMonitor.finishProcessing(pendingBundles)

        this.currentlyHandlingBlock = false
    }

    async replaceTransaction({
        submittedBundle,
        networkGasPrice,
        networkBaseFee,
        reason
    }: {
        submittedBundle: SubmittedBundleInfo
        networkGasPrice: GasPriceParameters
        networkBaseFee: bigint
        reason: "gas_price" | "stuck"
    }): Promise<void> {
        const {
            bundle,
            executor,
            transactionRequest,
            transactionHash: oldTxHash
        } = submittedBundle

        const { entryPoint } = bundle

        const bundleResult = await this.executor.bundle({
            executor: executor,
            networkGasPrice,
            networkBaseFee,
            userOpBundle: bundle,
            nonce: transactionRequest.nonce
        })

        // Handle case where no bundle was sent.
        if (!bundleResult.success) {
            // Free wallet as no bundle was sent.
            await this.senderManager.markWalletProcessed(executor)
            this.userOpMonitor.stopTrackingBundle(submittedBundle)

            const { rejectedUserOps, recoverableOps, reason } = bundleResult

            this.logger.warn(
                { oldTxHash, reason },
                "failed to replace transaction"
            )

            // Drop rejected ops
            await this.mempool.dropUserOps(entryPoint, rejectedUserOps)

            // Handle recoverable ops
            if (recoverableOps.length > 0) {
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
            ...submittedBundle,
            transactionRequest: newTransactionRequest,
            transactionHash: newTxHash,
            previousTransactionHashes: [
                submittedBundle.transactionHash,
                ...submittedBundle.previousTransactionHashes
            ],
            lastReplaced: Date.now(),
            bundle: {
                ...bundle,
                userOps: userOpsReplaced,
                submissionAttempts: bundle.submissionAttempts + 1
            }
        }

        // Replace existing submitted bundle with new one
        this.userOpMonitor.trackBundle(newTxInfo)

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
