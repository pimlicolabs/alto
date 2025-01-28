import type { EventManager, GasPriceManager } from "@alto/handlers"
import type {
    InterfaceReputationManager,
    MemoryMempool,
    Monitor
} from "@alto/mempool"
import {
    type BundlingMode,
    EntryPointV06Abi,
    type HexData32,
    type SubmittedUserOperation,
    type TransactionInfo,
    RejectedUserOperation,
    UserOperationBundle,
    UserOperationInfo
} from "@alto/types"
import type { BundlingStatus, Logger, Metrics } from "@alto/utils"
import {
    getAAError,
    getBundleStatus,
    parseUserOperationReceipt,
    scaleBigIntByPercent
} from "@alto/utils"
import {
    type Address,
    type Block,
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

function getTransactionsFromUserOperationEntries(
    entries: SubmittedUserOperation[]
): TransactionInfo[] {
    return Array.from(
        new Set(
            entries.map((entry) => {
                return entry.transactionInfo
            })
        )
    )
}

const MIN_INTERVAL = 100 // 0.1 seconds (100ms)
const MAX_INTERVAL = 1000 // Capped at 1 second (1000ms)
const SCALE_FACTOR = 10 // Interval increases by 5ms per task per minute
const RPM_WINDOW = 60000 // 1 minute window in ms

export class ExecutorManager {
    private senderManager: SenderManager
    private config: AltoConfig
    private executor: Executor
    private mempool: MemoryMempool
    private monitor: Monitor
    private logger: Logger
    private metrics: Metrics
    private reputationManager: InterfaceReputationManager
    private unWatch: WatchBlocksReturnType | undefined
    private currentlyHandlingBlock = false
    private gasPriceManager: GasPriceManager
    private eventManager: EventManager
    private opsCount: number[] = []
    private bundlingMode: BundlingMode

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
        mempool: MemoryMempool
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

        this.bundlingMode = this.config.bundleMode

        if (this.bundlingMode === "auto") {
            this.autoScalingBundling()
        }
    }

    async setBundlingMode(bundleMode: BundlingMode): Promise<void> {
        this.bundlingMode = bundleMode

        if (bundleMode === "manual") {
            await new Promise((resolve) =>
                setTimeout(resolve, 2 * MAX_INTERVAL)
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
                .map(({ userOperations }) => userOperations.length)
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
            MIN_INTERVAL + rpm * SCALE_FACTOR, // Linear scaling
            MAX_INTERVAL // Cap at 1000ms
        )

        if (this.bundlingMode === "auto") {
            setTimeout(this.autoScalingBundling.bind(this), nextInterval)
        }
    }

    // Debug endpoint
    async sendBundleNow(): Promise<Hash> {
        const bundle = (await this.mempool.getBundles(1))[0]

        if (bundle.userOperations.length === 0) {
            throw new Error("no ops to bundle")
        }

        const txHash = await this.sendBundleToExecutor(bundle)

        if (!txHash) {
            throw new Error("no tx hash")
        }

        return txHash
    }

    async sendBundleToExecutor(
        bundle: UserOperationBundle
    ): Promise<Hex | undefined> {
        const { entryPoint, userOperations, version } = bundle
        if (userOperations.length === 0) {
            return undefined
        }

        const wallet = await this.senderManager.getWallet()

        const [gasPriceParameters, nonce] = await Promise.all([
            this.gasPriceManager.tryGetNetworkGasPrice(),
            this.config.publicClient.getTransactionCount({
                address: wallet.address,
                blockTag: "latest"
            })
        ]).catch((_) => {
            return []
        })

        if (!gasPriceParameters || nonce === undefined) {
            this.resubmitUserOperations(
                bundle.userOperations,
                bundle.entryPoint,
                "Failed to get nonce and gas parameters for bundling"
            )
            // Free executor if failed to get initial params.
            this.senderManager.markWalletProcessed(wallet)
            return undefined
        }

        const bundleResult = await this.executor.bundle({
            wallet,
            bundle,
            nonce,
            gasPriceParameters,
            isReplacementTx: false
        })

        // Free wallet if no bundle was sent.
        if (bundleResult.status !== "bundle_success") {
            this.senderManager.markWalletProcessed(wallet)
        }

        // All ops failed simulation, drop them and return.
        if (bundleResult.status === "all_ops_failed_simulation") {
            const { rejectedUserOps } = bundleResult
            this.dropUserOps(rejectedUserOps)
            return undefined
        }

        // Unhandled error during simulation, drop all ops.
        if (bundleResult.status === "unhandled_simulation_failure") {
            const { reason } = bundleResult
            const { userOperations } = bundle
            const rejectedUserOps = userOperations.map((op) => ({
                userOperation: op,
                reason
            }))
            this.dropUserOps(rejectedUserOps)
            this.metrics.bundlesSubmitted.labels({ status: "failed" }).inc()
            return undefined
        }

        // Resubmit if executor has insufficient funds.
        if (
            bundleResult.status === "bundle_submission_failure" &&
            bundleResult.reason instanceof InsufficientFundsError
        ) {
            const { reason, userOpsToBundle, rejectedUserOps } = bundleResult
            this.dropUserOps(rejectedUserOps)
            this.resubmitUserOperations(
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
            // NOTE: these ops passed validation but dropped due to error during bundling
            this.dropUserOps(rejectedUserOps)
            this.resubmitUserOperations(
                userOpsToBundle,
                entryPoint,
                reason instanceof BaseError ? reason.name : "INTERNAL FAILURE"
            )
            this.metrics.bundlesSubmitted.labels({ status: "failed" }).inc()
            return undefined
        }

        if (bundleResult.status === "bundle_success") {
            const {
                userOpsBundled,
                rejectedUserOps: rejectedUserOperations,
                transactionRequest,
                transactionHash
            } = bundleResult

            const transactionInfo: TransactionInfo = {
                executor: wallet,
                transactionHash,
                transactionRequest,
                bundle: {
                    entryPoint,
                    version,
                    userOperations: userOpsBundled
                },
                previousTransactionHashes: [],
                lastReplaced: Date.now(),
                firstSubmitted: Date.now(),
                timesPotentiallyIncluded: 0
            }

            this.markUserOperationsAsSubmitted(userOpsBundled, transactionInfo)
            this.dropUserOps(rejectedUserOperations)
            this.metrics.bundlesSubmitted.labels({ status: "success" }).inc()

            return transactionHash
        }

        return undefined
    }

    startWatchingBlocks(handleBlock: (block: Block) => void): void {
        if (this.unWatch) {
            return
        }
        this.unWatch = this.config.publicClient.watchBlocks({
            onBlock: handleBlock,
            onError: (error) => {
                this.logger.error({ error }, "error while watching blocks")
            },
            emitMissed: false,
            includeTransactions: false,
            pollingInterval: this.config.pollingInterval
        })

        this.logger.debug("started watching blocks")
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
            transactionHash: currentTransactionHash,
            bundle,
            previousTransactionHashes
        } = transactionInfo
        const { userOperations, version, entryPoint } = bundle
        const isVersion06 = version === "0.6"

        const txHashesToCheck = [
            currentTransactionHash,
            ...previousTransactionHashes
        ]

        const transactionDetails = await Promise.all(
            txHashesToCheck.map(async (transactionHash) => ({
                transactionHash,
                ...(await getBundleStatus(
                    isVersion06,
                    transactionHash,
                    this.config.publicClient,
                    this.logger,
                    entryPoint
                ))
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
            this.senderManager.markWalletProcessed(transactionInfo.executor)
        }

        if (bundlingStatus.status === "included") {
            this.metrics.userOperationsOnChain
                .labels({ status: bundlingStatus.status })
                .inc(userOperations.length)

            const firstSubmitted = transactionInfo.firstSubmitted
            const { userOperationDetails } = bundlingStatus
            userOperations.map((userOperation) => {
                const userOpHash = userOperation.hash
                const opDetails = userOperationDetails[userOpHash]

                this.metrics.userOperationInclusionDuration.observe(
                    (Date.now() - firstSubmitted) / 1000
                )
                this.mempool.removeSubmitted(userOpHash)
                this.reputationManager.updateUserOperationIncludedStatus(
                    userOperation,
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
                this.monitor.setUserOperationStatus(userOpHash, {
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
        }

        if (bundlingStatus.status === "reverted") {
            await Promise.all(
                userOperations.map((userOperation) => {
                    this.checkFrontrun({
                        userOperationHash: userOperation.hash,
                        transactionHash,
                        blockNumber
                    })
                })
            )
            this.removeSubmitted(userOperations)
        }
    }

    checkFrontrun({
        userOperationHash,
        transactionHash,
        blockNumber
    }: {
        userOperationHash: HexData32
        transactionHash: Hash
        blockNumber: bigint
    }) {
        const unwatch = this.config.publicClient.watchBlockNumber({
            onBlockNumber: async (currentBlockNumber) => {
                if (currentBlockNumber > blockNumber + 1n) {
                    const userOperationReceipt =
                        await this.getUserOperationReceipt(userOperationHash)

                    if (userOperationReceipt) {
                        const transactionHash =
                            userOperationReceipt.receipt.transactionHash
                        const blockNumber =
                            userOperationReceipt.receipt.blockNumber

                        this.monitor.setUserOperationStatus(userOperationHash, {
                            status: "included",
                            transactionHash
                        })

                        this.eventManager.emitFrontranOnChain(
                            userOperationHash,
                            transactionHash,
                            blockNumber
                        )

                        this.logger.info(
                            {
                                userOpHash: userOperationHash,
                                transactionHash
                            },
                            "user op frontrun onchain"
                        )

                        this.metrics.userOperationsOnChain
                            .labels({ status: "frontran" })
                            .inc(1)
                    } else {
                        this.monitor.setUserOperationStatus(userOperationHash, {
                            status: "failed",
                            transactionHash
                        })
                        this.eventManager.emitFailedOnChain(
                            userOperationHash,
                            transactionHash,
                            blockNumber
                        )
                        this.logger.info(
                            {
                                userOpHash: userOperationHash,
                                transactionHash
                            },
                            "user op failed onchain"
                        )
                        this.metrics.userOperationsOnChain
                            .labels({ status: "reverted" })
                            .inc(1)
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
            const latestBlock = await this.config.publicClient.getBlockNumber()
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

    async handleBlock(block: Block) {
        if (this.currentlyHandlingBlock) {
            return
        }

        this.currentlyHandlingBlock = true
        this.logger.debug({ blockNumber: block.number }, "handling block")

        const submittedEntries = this.mempool.dumpSubmittedOps()
        if (submittedEntries.length === 0) {
            this.stopWatchingBlocks()
            this.currentlyHandlingBlock = false
            return
        }

        // refresh op statuses
        const ops = this.mempool.dumpSubmittedOps()
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
            this.mempool.dumpSubmittedOps()
        )

        await Promise.all(
            transactionInfos.map(async (txInfo) => {
                const isMaxFeeTooLow =
                    txInfo.transactionRequest.maxFeePerGas <
                    gasPriceParameters.maxFeePerGas

                const isPriorityFeeTooLow =
                    txInfo.transactionRequest.maxPriorityFeePerGas <
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
        reason: string
    ): Promise<void> {
        const gasPriceParameters = await this.gasPriceManager
            .tryGetNetworkGasPrice()
            .catch((_) => {
                return undefined
            })

        if (!gasPriceParameters) {
            this.failedToReplaceTransaction({
                txInfo,
                reason: "Failed to get network gas price during replacement"
            })
            // Free executor if failed to get initial params.
            this.senderManager.markWalletProcessed(txInfo.executor)
            return
        }

        // Setup vars
        const { bundle, executor, transactionRequest } = txInfo
        const oldTxHash = txInfo.transactionHash

        const bundleResult = await this.executor.bundle({
            wallet: executor,
            bundle,
            nonce: transactionRequest.nonce,
            gasPriceParameters: {
                maxFeePerGas: scaleBigIntByPercent(
                    gasPriceParameters.maxFeePerGas,
                    115n
                ),
                maxPriorityFeePerGas: scaleBigIntByPercent(
                    gasPriceParameters.maxPriorityFeePerGas,
                    115n
                )
            },
            gasLimitSuggestion: transactionRequest.gas,
            isReplacementTx: true
        })

        // Log metrics.
        const replaceStatus =
            bundleResult && bundleResult.status === "bundle_success"
                ? "succeeded"
                : "failed"

        this.metrics.replacedTransactions
            .labels({ reason, status: replaceStatus })
            .inc()

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

        if (potentiallyIncluded) {
            this.logger.info(
                { oldTxHash },
                "transaction potentially already included"
            )
            txInfo.timesPotentiallyIncluded += 1

            if (txInfo.timesPotentiallyIncluded >= 3) {
                this.removeSubmitted(bundle.userOperations)
                this.logger.warn(
                    { oldTxHash },
                    "transaction potentially already included too many times, removing"
                )
                this.senderManager.markWalletProcessed(executor)
            }

            return
        }

        // Free wallet if no bundle was sent.
        if (bundleResult.status !== "bundle_success") {
            this.senderManager.markWalletProcessed(txInfo.executor)
        }

        if (bundleResult.status === "unhandled_simulation_failure") {
            this.failedToReplaceTransaction({
                txInfo,
                reason: bundleResult.reason
            })

            return
        }

        if (bundleResult.status === "all_ops_failed_simulation") {
            this.failedToReplaceTransaction({
                txInfo,
                reason: "all ops failed simulation",
                rejectedUserOperations: bundleResult.rejectedUserOps
            })

            return
        }

        if (bundleResult.status === "bundle_submission_failure") {
            const reason =
                bundleResult.reason instanceof BaseError
                    ? bundleResult.reason.name
                    : "INTERNAL FAILURE"

            this.failedToReplaceTransaction({
                txInfo,
                reason
            })

            return
        }

        const {
            rejectedUserOps: rejectedUserOperations,
            userOpsBundled,
            transactionRequest: newTransactionRequest,
            transactionHash: newTransactionHash
        } = bundleResult

        const newTxInfo: TransactionInfo = {
            ...txInfo,
            transactionRequest: newTransactionRequest,
            transactionHash: newTransactionHash,
            previousTransactionHashes: [
                txInfo.transactionHash,
                ...txInfo.previousTransactionHashes
            ],
            lastReplaced: Date.now(),
            bundle: {
                ...txInfo.bundle,
                userOperations: userOpsBundled
            }
        }

        userOpsBundled.map((userOperation) => {
            this.mempool.replaceSubmitted(userOperation, newTxInfo)
        })

        // Drop all userOperations that were rejected during simulation.
        this.dropUserOps(rejectedUserOperations)

        this.logger.info(
            {
                oldTxHash: txInfo.transactionHash,
                newTxHash: newTxInfo.transactionHash,
                reason
            },
            "replaced transaction"
        )

        return
    }

    markUserOperationsAsSubmitted(
        userOperations: UserOperationInfo[],
        transactionInfo: TransactionInfo
    ) {
        userOperations.map((op) => {
            const opHash = op.hash
            this.mempool.markSubmitted(opHash, transactionInfo)
            this.startWatchingBlocks(this.handleBlock.bind(this))
            this.metrics.userOperationsSubmitted
                .labels({ status: "success" })
                .inc()
        })
    }

    resubmitUserOperations(
        userOperations: UserOperationInfo[],
        entryPoint: Address,
        reason: string
    ) {
        userOperations.map((op) => {
            const userOpHash = op.hash
            this.logger.info(
                {
                    userOpHash,
                    reason
                },
                "resubmitting user operation"
            )
            this.mempool.removeProcessing(userOpHash)
            this.mempool.add(op, entryPoint)
            this.metrics.userOperationsResubmitted.inc()
        })
    }

    failedToReplaceTransaction({
        txInfo,
        rejectedUserOperations,
        reason
    }: {
        txInfo: TransactionInfo
        rejectedUserOperations?: RejectedUserOperation[]
        reason: string
    }) {
        const { transactionHash: oldTxHash } = txInfo
        this.logger.warn({ oldTxHash, reason }, "failed to replace transaction")

        const opsToDrop =
            rejectedUserOperations ??
            txInfo.bundle.userOperations.map((userOperation) => ({
                userOperation,
                reason: "Failed to replace transaction"
            }))
        this.dropUserOps(opsToDrop)
    }

    removeSubmitted(userOperations: UserOperationInfo[]) {
        userOperations.map((userOperation) => {
            this.mempool.removeSubmitted(userOperation.hash)
        })
    }

    dropUserOps(rejectedUserOperations: RejectedUserOperation[]) {
        rejectedUserOperations.map((rejectedUserOperation) => {
            const { userOperation, reason } = rejectedUserOperation
            const userOpHash = userOperation.hash
            this.mempool.removeProcessing(userOpHash)
            this.mempool.removeSubmitted(userOpHash)
            this.eventManager.emitDropped(
                userOpHash,
                reason,
                getAAError(reason)
            )
            this.monitor.setUserOperationStatus(userOpHash, {
                status: "rejected",
                transactionHash: null
            })
            this.logger.warn(
                {
                    userOperation: JSON.stringify(userOperation, (_k, v) =>
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
    }
}
