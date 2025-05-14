import type { EventManager, GasPriceManager } from "@alto/handlers"
import type {
    InterfaceReputationManager,
    Mempool,
    Monitor
} from "@alto/mempool"
import {
    type BundlingMode,
    EntryPointV06Abi,
    type HexData32,
    type SubmittedUserOp,
    type TransactionInfo,
    RejectedUserOp,
    UserOperationBundle,
    UserOpInfo
} from "@alto/types"
import type { BundlingStatus, Logger, Metrics } from "@alto/utils"
import {
    getAAError,
    getBundleStatus,
    minBigInt,
    parseUserOperationReceipt,
    scaleBigIntByPercent
} from "@alto/utils"
import {
    type Address,
    type Hash,
    type TransactionReceipt,
    TransactionReceiptNotFoundError,
    type WatchBlocksReturnType,
    getAbiItem,
    Hex,
    InsufficientFundsError,
    NonceTooLowError
} from "viem"
import type { Executor } from "./executor"
import type { AltoConfig } from "../createConfig"
import { SenderManager } from "./senderManager"
import { BaseError } from "abitype"
import { getUserOpHashes } from "./utils"

function getTransactionsFromUserOperationEntries(
    submittedOps: SubmittedUserOp[]
): TransactionInfo[] {
    const transactionInfos = submittedOps.map(
        (userOpInfo) => userOpInfo.transactionInfo
    )

    // Remove duplicates
    return Array.from(new Set(transactionInfos))
}

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
    private reputationManager: InterfaceReputationManager
    private unWatch: WatchBlocksReturnType | undefined
    private gasPriceManager: GasPriceManager
    private eventManager: EventManager
    private opsCount: number[] = []
    private bundlingMode: BundlingMode
    private cachedLatestBlock: { value: bigint; timestamp: number } | null =
        null
    private blockCacheTTL: number

    private currentlyHandlingBlock = false

    private async getLatestBlockWithCache(): Promise<bigint> {
        const now = Date.now()
        if (
            this.cachedLatestBlock &&
            now - this.cachedLatestBlock.timestamp < this.blockCacheTTL
        ) {
            // Use cached block number if it's still valid
            this.logger.debug("Using cached block number")
            return this.cachedLatestBlock.value
        }

        // Otherwise fetch a new block number and cache it
        const latestBlock = await this.config.publicClient.getBlockNumber()
        this.cachedLatestBlock = { value: latestBlock, timestamp: now }
        this.logger.debug("Fetched and cached new block number")
        return latestBlock
    }

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
        this.reputationManager = reputationManager
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

        this.blockCacheTTL = config.blockNumberCacheTtl
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

    async autoScalingBundling() {
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
            await Promise.all(
                bundles.map(async (bundle) => {
                    await this.sendBundleToExecutor(bundle)
                })
            )
        }

        const rpm: number = this.opsCount.length
        // Calculate next interval with linear scaling
        const nextInterval: number = Math.min(
            this.config.minBundleInterval + rpm * SCALE_FACTOR, // Linear scaling
            this.config.maxBundleInterval // Cap at configured max interval
        )

        if (this.bundlingMode === "auto") {
            setTimeout(this.autoScalingBundling.bind(this), nextInterval)
        }
    }

    startWatchingBlocks(handleBlock: (blockNumber: bigint) => void): void {
        if (this.unWatch) {
            return
        }
        this.unWatch = this.config.publicClient.watchBlockNumber({
            onBlockNumber: handleBlock,
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

    async sendBundleToExecutor(
        userOpBundle: UserOperationBundle
    ): Promise<Hex | undefined> {
        const { entryPoint, userOps, version } = userOpBundle
        if (userOps.length === 0) {
            return undefined
        }

        const wallet = await this.senderManager.getWallet()

        const [gasPriceParams, nonce] = await Promise.all([
            this.gasPriceManager.tryGetNetworkGasPrice(),
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
            nonce,
            gasPriceParams,
            isReplacementTx: false
        })

        // Free wallet if no bundle was sent.
        if (bundleResult.status !== "bundle_success") {
            await this.senderManager.markWalletProcessed(wallet)
        }

        // All ops failed simulation, drop them and return.
        if (bundleResult.status === "all_ops_failed_simulation") {
            const { rejectedUserOps } = bundleResult
            await this.dropUserOps(entryPoint, rejectedUserOps)
            return undefined
        }

        // Unhandled error during simulation, drop all ops.
        if (bundleResult.status === "unhandled_simulation_failure") {
            const { rejectedUserOps } = bundleResult
            await this.dropUserOps(entryPoint, rejectedUserOps)
            this.metrics.bundlesSubmitted.labels({ status: "failed" }).inc()
            return undefined
        }

        // Resubmit if executor has insufficient funds.
        if (
            bundleResult.status === "bundle_submission_failure" &&
            bundleResult.reason instanceof InsufficientFundsError
        ) {
            const { reason, userOpsToBundle, rejectedUserOps } = bundleResult
            await this.dropUserOps(entryPoint, rejectedUserOps)
            await this.resubmitUserOperations(
                userOpsToBundle,
                entryPoint,
                reason.name
            )
            this.metrics.bundlesSubmitted.labels({ status: "resubmit" }).inc()
            return undefined
        }

        // Encountered unhandled error during bundle simulation.
        if (bundleResult.status === "bundle_submission_failure") {
            const { rejectedUserOps, userOpsToBundle, reason } = bundleResult
            await this.dropUserOps(entryPoint, rejectedUserOps)
            // NOTE: these ops passed validation, so we can try resubmitting them
            await this.resubmitUserOperations(
                userOpsToBundle,
                entryPoint,
                reason instanceof BaseError
                    ? reason.name
                    : "Encountered unhandled error during bundle simulation"
            )
            this.metrics.bundlesSubmitted.labels({ status: "failed" }).inc()
            return undefined
        }

        if (bundleResult.status === "bundle_success") {
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
                    userOps: userOpsBundled
                },
                previousTransactionHashes: [],
                lastReplaced: Date.now(),
                submissionAttempts: 1,
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

    // update the current status of the bundling transaction/s
    private async refreshTransactionStatus(transactionInfo: TransactionInfo) {
        const {
            transactionHash: currentTxhash,
            bundle,
            previousTransactionHashes
        } = transactionInfo

        const { userOps, entryPoint } = bundle
        const txHashesToCheck = [currentTxhash, ...previousTransactionHashes]

        const transactionDetails = await Promise.all(
            txHashesToCheck.map(async (transactionHash) => ({
                transactionHash,
                ...(await getBundleStatus({
                    transactionHash,
                    bundle: transactionInfo.bundle,
                    publicClient: this.config.publicClient,
                    logger: this.logger
                }))
            }))
        )

        // first check if bundling txs returns status "mined", if not, check for reverted
        const mined = transactionDetails.find(
            ({ bundlingStatus }) => bundlingStatus.status === "included"
        )
        const reverted = transactionDetails.find(
            ({ bundlingStatus }) => bundlingStatus.status === "reverted"
        )

        const finalizedTransaction = mined ?? reverted

        if (!finalizedTransaction) {
            return
        }

        const { bundlingStatus, transactionHash, blockNumber } =
            finalizedTransaction as {
                bundlingStatus: BundlingStatus
                blockNumber: bigint // block number is undefined only if transaction is not found
                transactionHash: `0x${string}`
            }

        // TODO: there has to be a better way of solving onchain AA95 errors.
        if (bundlingStatus.status === "reverted" && bundlingStatus.isAA95) {
            // resubmit with more gas when bundler encounters AA95
            transactionInfo.transactionRequest.gas = scaleBigIntByPercent(
                transactionInfo.transactionRequest.gas,
                this.config.aa95GasMultiplier
            )
            transactionInfo.transactionRequest.nonce += 1

            await this.replaceTransaction(transactionInfo, "AA95")
            return
        }

        // Free executor if tx landed onchain
        if (bundlingStatus.status !== "not_found") {
            await this.senderManager.markWalletProcessed(
                transactionInfo.executor
            )
        }

        if (bundlingStatus.status === "included") {
            const { userOperationDetails } = bundlingStatus
            await this.markUserOpsIncluded(
                userOps,
                entryPoint,
                blockNumber,
                transactionHash,
                userOperationDetails
            )
        }

        if (bundlingStatus.status === "reverted") {
            await Promise.all(
                userOps.map(async (userOpInfo) => {
                    const { userOpHash } = userOpInfo
                    await this.checkFrontrun({
                        entryPoint,
                        userOpHash,
                        transactionHash,
                        blockNumber
                    })
                })
            )
            await this.removeSubmitted(entryPoint, userOps)
        }
    }

    async checkFrontrun({
        userOpHash,
        entryPoint,
        transactionHash,
        blockNumber
    }: {
        userOpHash: HexData32
        transactionHash: Hash
        entryPoint: Address
        blockNumber: bigint
    }) {
        const unwatch = this.config.publicClient.watchBlockNumber({
            onBlockNumber: async (currentBlockNumber) => {
                if (currentBlockNumber > blockNumber + 1n) {
                    try {
                        const userOperationReceipt =
                            await this.getUserOperationReceipt(userOpHash)

                        if (userOperationReceipt) {
                            const transactionHash =
                                userOperationReceipt.receipt.transactionHash
                            const blockNumber =
                                userOperationReceipt.receipt.blockNumber

                            await this.mempool.removeSubmitted({
                                entryPoint,
                                userOpHash
                            })
                            await this.monitor.setUserOperationStatus(
                                userOpHash,
                                {
                                    status: "included",
                                    transactionHash
                                }
                            )

                            this.eventManager.emitFrontranOnChain(
                                userOpHash,
                                transactionHash,
                                blockNumber
                            )

                            this.logger.info(
                                {
                                    userOpHash,
                                    transactionHash
                                },
                                "user op frontrun onchain"
                            )

                            this.metrics.userOperationsOnChain
                                .labels({ status: "frontran" })
                                .inc(1)
                        } else {
                            await this.monitor.setUserOperationStatus(
                                userOpHash,
                                {
                                    status: "failed",
                                    transactionHash
                                }
                            )
                            this.eventManager.emitFailedOnChain(
                                userOpHash,
                                transactionHash,
                                blockNumber
                            )
                            this.logger.info(
                                {
                                    userOpHash,
                                    transactionHash
                                },
                                "user op failed onchain"
                            )
                            this.metrics.userOperationsOnChain
                                .labels({ status: "reverted" })
                                .inc(1)
                        }
                    } catch (error) {
                        this.logger.error(
                            {
                                userOpHash,
                                transactionHash,
                                error
                            },
                            "Error checking frontrun status"
                        )

                        // Still mark as failed since we couldn't verify inclusion
                        await this.monitor.setUserOperationStatus(userOpHash, {
                            status: "failed",
                            transactionHash
                        })
                    }
                    unwatch()
                }
            }
        })
    }

    async getUserOperationReceipt(userOperationHash: HexData32) {
        const userOperationEventAbiItem = getAbiItem({
            abi: EntryPointV06Abi,
            name: "UserOperationEvent"
        })

        let fromBlock: bigint | undefined = undefined
        let toBlock: "latest" | undefined = undefined
        if (this.config.maxBlockRange !== undefined) {
            const latestBlock = await this.getLatestBlockWithCache()

            fromBlock = latestBlock - BigInt(this.config.maxBlockRange)
            if (fromBlock < 0n) {
                fromBlock = 0n
            }
            toBlock = "latest"
        }

        const filterResult = await this.config.publicClient.getLogs({
            address: this.config.entrypoints,
            event: userOperationEventAbiItem,
            fromBlock,
            toBlock,
            args: {
                userOpHash: userOperationHash
            }
        })

        this.logger.debug(
            {
                filterResult: filterResult.length,
                userOperationEvent:
                    filterResult.length === 0
                        ? undefined
                        : filterResult[0].transactionHash
            },
            "filter result length"
        )

        if (filterResult.length === 0) {
            return null
        }

        const userOperationEvent = filterResult[0]
        // throw if any of the members of userOperationEvent are undefined
        if (
            userOperationEvent.args.actualGasCost === undefined ||
            userOperationEvent.args.sender === undefined ||
            userOperationEvent.args.nonce === undefined ||
            userOperationEvent.args.userOpHash === undefined ||
            userOperationEvent.args.success === undefined ||
            userOperationEvent.args.paymaster === undefined ||
            userOperationEvent.args.actualGasUsed === undefined
        ) {
            throw new Error("userOperationEvent has undefined members")
        }

        const txHash = userOperationEvent.transactionHash
        if (txHash === null) {
            // transaction pending
            return null
        }

        const getTransactionReceipt = async (
            txHash: HexData32
        ): Promise<TransactionReceipt> => {
            while (true) {
                try {
                    const transactionReceipt =
                        await this.config.publicClient.getTransactionReceipt({
                            hash: txHash
                        })

                    let effectiveGasPrice: bigint | undefined =
                        transactionReceipt.effectiveGasPrice ??
                        (transactionReceipt as any).gasPrice ??
                        undefined

                    if (effectiveGasPrice === undefined) {
                        const tx =
                            await this.config.publicClient.getTransaction({
                                hash: txHash
                            })
                        effectiveGasPrice = tx.gasPrice ?? undefined
                    }

                    if (effectiveGasPrice) {
                        transactionReceipt.effectiveGasPrice = effectiveGasPrice
                    }

                    return transactionReceipt
                } catch (e) {
                    if (e instanceof TransactionReceiptNotFoundError) {
                        continue
                    }

                    throw e
                }
            }
        }

        const receipt = await getTransactionReceipt(txHash)
        const logs = receipt.logs

        if (
            logs.some(
                (log) =>
                    log.blockHash === null ||
                    log.blockNumber === null ||
                    log.transactionIndex === null ||
                    log.transactionHash === null ||
                    log.logIndex === null ||
                    log.topics.length === 0
            )
        ) {
            // transaction pending
            return null
        }

        const userOperationReceipt = parseUserOperationReceipt(
            userOperationHash,
            receipt
        )

        return userOperationReceipt
    }

    async handleBlock(blockNumber: bigint) {
        // Update the cached block number whenever we receive a new block
        this.cachedLatestBlock = { value: blockNumber, timestamp: Date.now() }

        if (this.currentlyHandlingBlock) {
            return
        }

        this.currentlyHandlingBlock = true
        this.logger.debug({ blockNumber }, "handling block")

        const dumpSubmittedEntries = async () => {
            const submittedEntries = []
            for (const entryPoint of this.config.entrypoints) {
                const entries = await this.mempool.dumpSubmittedOps(entryPoint)
                submittedEntries.push(...entries)
            }
            return submittedEntries
        }

        const submittedEntries = await dumpSubmittedEntries()
        if (submittedEntries.length === 0) {
            this.stopWatchingBlocks()
            this.currentlyHandlingBlock = false
            return
        }

        // refresh op statuses
        const ops = await dumpSubmittedEntries()
        const txs = getTransactionsFromUserOperationEntries(ops)
        await Promise.all(
            txs.map((txInfo) => this.refreshTransactionStatus(txInfo))
        )

        // for all still not included check if needs to be replaced (based on gas price)
        const gasPriceParameters = await this.gasPriceManager
            .tryGetNetworkGasPrice()
            .catch(() => ({
                maxFeePerGas: 0n,
                maxPriorityFeePerGas: 0n
            }))

        const transactionInfos = getTransactionsFromUserOperationEntries(
            await dumpSubmittedEntries()
        )

        await Promise.all(
            transactionInfos.map(async (txInfo) => {
                const { transactionRequest } = txInfo
                const { maxFeePerGas, maxPriorityFeePerGas } =
                    transactionRequest

                const isMaxFeeTooLow =
                    maxFeePerGas < gasPriceParameters.maxFeePerGas

                const isPriorityFeeTooLow =
                    maxPriorityFeePerGas <
                    gasPriceParameters.maxPriorityFeePerGas

                const isStuck =
                    Date.now() - txInfo.lastReplaced >
                    this.config.resubmitStuckTimeout

                if (isMaxFeeTooLow || isPriorityFeeTooLow) {
                    await this.replaceTransaction(txInfo, "gas_price")
                    return
                }

                if (isStuck) {
                    await this.replaceTransaction(txInfo, "stuck")
                    return
                }
            })
        )

        this.currentlyHandlingBlock = false
    }

    async replaceTransaction(
        txInfo: TransactionInfo,
        reason: "AA95" | "gas_price" | "stuck"
    ): Promise<void> {
        // Setup vars
        const {
            bundle,
            executor,
            transactionRequest,
            transactionHash: oldTxHash
        } = txInfo
        const { userOps, entryPoint } = bundle

        const gasPriceParams = await this.gasPriceManager
            .tryGetNetworkGasPrice()
            .catch((_) => {
                return undefined
            })

        if (!gasPriceParams) {
            const rejectedUserOps = userOps.map((userOpInfo) => ({
                ...userOpInfo,
                reason: "Failed to get network gas price during replacement"
            }))
            await this.failedToReplaceTransaction({
                entryPoint,
                rejectedUserOps,
                oldTxHash,
                reason: "Failed to get network gas price during replacement"
            })
            // Free executor if failed to get initial params.
            await this.senderManager.markWalletProcessed(txInfo.executor)
            return
        }

        // If the transaction is stuck increase gasPrice based on number of submission attempts.
        if (reason === "stuck" || reason === "gas_price") {
            const multiplier = 100n + BigInt(txInfo.submissionAttempts) * 20n
            const multiplierCeiling = this.config.resubmitMultiplierCeiling

            gasPriceParams.maxFeePerGas = scaleBigIntByPercent(
                gasPriceParams.maxFeePerGas,
                minBigInt(multiplier, multiplierCeiling)
            )
            gasPriceParams.maxPriorityFeePerGas = scaleBigIntByPercent(
                gasPriceParams.maxPriorityFeePerGas,
                minBigInt(multiplier, multiplierCeiling)
            )
        }

        const bundleResult = await this.executor.bundle({
            executor: executor,
            userOpBundle: bundle,
            nonce: transactionRequest.nonce,
            gasPriceParams,
            gasLimitSuggestion: transactionRequest.gas,
            isReplacementTx: true
        })

        // Free wallet and return if potentially included too many times.
        if (txInfo.timesPotentiallyIncluded >= 3) {
            this.removeSubmitted(entryPoint, bundle.userOps)
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
        if (bundleResult.status !== "bundle_success") {
            await this.senderManager.markWalletProcessed(txInfo.executor)
        }

        // Check if the transaction is potentially included.
        const nonceTooLow =
            bundleResult.status === "bundle_submission_failure" &&
            bundleResult.reason instanceof NonceTooLowError

        const allOpsFailedSimulation =
            bundleResult.status === "all_ops_failed_simulation" &&
            bundleResult.rejectedUserOps.every(
                (op) =>
                    op.reason === "AA25 invalid account nonce" ||
                    op.reason === "AA10 sender already constructed"
            )

        const potentiallyIncluded = nonceTooLow || allOpsFailedSimulation

        // log metrics
        const replaceStatus = (() => {
            switch (true) {
                case potentiallyIncluded:
                    return "potentially_already_included"
                case bundleResult?.status === "bundle_success":
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

        if (bundleResult.status === "unhandled_simulation_failure") {
            const { rejectedUserOps, reason } = bundleResult
            await this.failedToReplaceTransaction({
                entryPoint,
                oldTxHash,
                reason,
                rejectedUserOps
            })
            return
        }

        if (bundleResult.status === "all_ops_failed_simulation") {
            await this.failedToReplaceTransaction({
                entryPoint,
                oldTxHash,
                reason: "all ops failed simulation",
                rejectedUserOps: bundleResult.rejectedUserOps
            })
            return
        }

        if (bundleResult.status === "bundle_submission_failure") {
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
            submissionAttempts: txInfo.submissionAttempts + 1,
            bundle: {
                ...txInfo.bundle,
                userOps: userOpsReplaced
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
                this.startWatchingBlocks(this.handleBlock.bind(this))
                this.metrics.userOperationsSubmitted
                    .labels({ status: "success" })
                    .inc()
            })
        )
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

    async removeSubmitted(entryPoint: Address, userOps: UserOpInfo[]) {
        await Promise.all(
            userOps.map(async (userOpInfo) => {
                const { userOpHash } = userOpInfo
                await this.mempool.removeSubmitted({ entryPoint, userOpHash })
            })
        )
    }

    async markUserOpsIncluded(
        userOps: UserOpInfo[],
        entryPoint: Address,
        blockNumber: bigint,
        transactionHash: Hash,
        userOperationDetails: Record<string, any>
    ) {
        await Promise.all(
            userOps.map(async (userOpInfo) => {
                this.metrics.userOperationsOnChain
                    .labels({ status: "included" })
                    .inc()

                const { userOpHash, userOp, submissionAttempts } = userOpInfo
                const opDetails = userOperationDetails[userOpHash]

                const firstSubmitted = userOpInfo.addedToMempool
                this.metrics.userOperationInclusionDuration.observe(
                    (Date.now() - firstSubmitted) / 1000
                )

                // Track the number of submission attempts for included ops
                this.metrics.userOperationsSubmissionAttempts.observe(
                    submissionAttempts
                )

                await this.mempool.removeSubmitted({ entryPoint, userOpHash })
                this.reputationManager.updateUserOperationIncludedStatus(
                    userOp,
                    entryPoint,
                    opDetails.accountDeployed
                )

                if (opDetails.status === "succesful") {
                    this.eventManager.emitIncludedOnChain(
                        userOpHash,
                        transactionHash,
                        blockNumber as bigint
                    )
                } else {
                    this.eventManager.emitExecutionRevertedOnChain(
                        userOpHash,
                        transactionHash,
                        opDetails.revertReason || "0x",
                        blockNumber as bigint
                    )
                }

                await this.monitor.setUserOperationStatus(userOpHash, {
                    status: "included",
                    transactionHash
                })

                this.logger.info(
                    {
                        opHash: userOpHash,
                        transactionHash
                    },
                    "user op included"
                )
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
                        userOperation: JSON.stringify(userOp, (_k, v) =>
                            typeof v === "bigint" ? v.toString() : v
                        ),
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
