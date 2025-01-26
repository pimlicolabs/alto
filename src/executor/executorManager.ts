import type { EventManager, GasPriceManager } from "@alto/handlers"
import type {
    InterfaceReputationManager,
    MemoryMempool,
    Monitor
} from "@alto/mempool"
import {
    type BundleResult,
    type BundlingMode,
    EntryPointV06Abi,
    type HexData32,
    type UserOperation,
    type SubmittedUserOperation,
    type TransactionInfo,
    type UserOperationInfo,
    RejectedUserOperation
} from "@alto/types"
import type { BundlingStatus, Logger, Metrics } from "@alto/utils"
import {
    getAAError,
    getBundleStatus,
    getUserOperationHash,
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
    Account
} from "viem"
import type { Executor, ReplaceTransactionResult } from "./executor"
import type { AltoConfig } from "../createConfig"
import { SenderManager } from "./senderManager"

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

        const bundles = await this.getMempoolBundles()

        if (bundles.length > 0) {
            const opsCount: number = bundles
                .map(({ userOperations }) => userOperations.length)
                .reduce((a, b) => a + b)
            const timestamp: number = Date.now()
            this.opsCount.push(...Array(opsCount).fill(timestamp)) // Add timestamps for each task

            await this.sendBundles(bundles)
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

    async getMempoolBundles(maxBundleCount?: number) {
        const bundlePromises = this.config.entrypoints.map(
            async (entryPoint) => {
                const mempoolBundles = await this.mempool.process({
                    entryPoint,
                    maxGasLimit: this.config.maxGasPerBundle,
                    minOpsPerBundle: 1,
                    maxBundleCount
                })

                return mempoolBundles.map((userOperations) => ({
                    entryPoint,
                    userOperations
                }))
            }
        )

        const bundlesNested = await Promise.all(bundlePromises)
        const bundles = bundlesNested.flat()

        return bundles
    }

    // Debug endpoint
    async sendBundleNow(): Promise<Hash> {
        const bundle = (await this.getMempoolBundles(1))[0]

        const { entryPoint, userOperations } = bundle
        if (userOperations.length === 0) {
            throw new Error("no ops to bundle")
        }

        const txHashes = await this.sendBundleToExecutor(
            entryPoint,
            userOperations.map((op) => op.userOperation)
        )
        const txHash = txHashes[0]

        if (!txHash) {
            throw new Error("no tx hash")
        }

        return txHash
    }

    getOpHash(userOperation: UserOperation): HexData32 {
        return getUserOperationHash(
            userOperation,
            this.config.entrypoints[0],
            this.config.publicClient.chain.id
        )
    }

    async sendBundleToExecutor(bundle: {
        entryPoint: Address
        userOps: UserOperation[]
    }): Promise<Hex[]> {
        if (bundle.userOps.length === 0) {
            return []
        }

        const bundles: { wallet: Account; bundle: BundleResult }[] = []
        if (userOps.length > 0) {
            const wallet = await this.senderManager.getWallet()
            bundles.push({
                wallet,
                bundle: await this.executor.bundle(wallet, entryPoint, userOps)
            })
        }

        let txHashes: Hex[] = []
        for (const { wallet, bundle } of bundles) {
            switch (bundle.status) {
                case "bundle_success":
                    this.metrics.bundlesSubmitted
                        .labels({ status: "success" })
                        .inc()
                    break
                case "bundle_failure":
                    this.metrics.bundlesSubmitted
                        .labels({ status: "failed" })
                        .inc()
                    break
                case "bundle_resubmit":
                    this.metrics.bundlesSubmitted
                        .labels({ status: "resubmit" })
                        .inc()
                    break
            }

            // Free wallet if the wallet did not make a succesful bundle tx.
            if (
                bundle.status === "bundle_failure" ||
                bundle.status === "bundle_resubmit"
            ) {
                this.senderManager.markWalletProcessed(wallet)
            }

            if (bundle.status === "bundle_resubmit") {
                const { userOps: userOperations, reason } = bundle
                this.resubmitUserOperations(userOperations, entryPoint, reason)
            }

            if (bundle.status === "bundle_failure") {
                const { userOps, reason } = bundle

                const droppedUserOperations = userOps.map((op) => ({
                    userOperation: op,
                    reason
                }))
                this.dropUserOperations(droppedUserOperations)
            }

            if (bundle.status === "bundle_success") {
                const {
                    userOpsBundled,
                    rejectedUserOperations,
                    transactionInfo
                } = bundle
                txHashes.push(transactionInfo.transactionHash)

                this.markUserOperationsAsSubmitted(
                    userOpsBundled,
                    transactionInfo
                )

                this.dropUserOperations(rejectedUserOperations)
            }
        }

        return txHashes
    }

    async sendBundles(
        bundles: {
            entryPoint: Address
            userOperations: UserOperationInfo[]
        }[] = []
    ) {
        await Promise.all(
            bundles.map(async (bundle) => {
                const { entryPoint, userOperations } = bundle
                await this.sendBundleToExecutor(
                    entryPoint,
                    userOperations.map((op) => op.userOperation)
                )
            })
        )
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
    private async refreshTransactionStatus(
        entryPoint: Address,
        transactionInfo: TransactionInfo
    ) {
        const {
            transactionHash: currentTransactionHash,
            userOperationInfos: opInfos,
            previousTransactionHashes,
            isVersion06
        } = transactionInfo

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
            for (const { userOperationHash } of opInfos) {
                this.logger.trace(
                    {
                        userOperationHash,
                        currentTransactionHash
                    },
                    "user op still pending"
                )
            }
            return
        }

        const { bundlingStatus, transactionHash, blockNumber } =
            finalizedTransaction as {
                bundlingStatus: BundlingStatus
                blockNumber: bigint // block number is undefined only if transaction is not found
                transactionHash: `0x${string}`
            }

        if (bundlingStatus.status === "included") {
            this.metrics.userOperationsOnChain
                .labels({ status: bundlingStatus.status })
                .inc(opInfos.length)

            const { userOperationDetails } = bundlingStatus
            opInfos.map((opInfo) => {
                const { userOperation, userOperationHash, entryPoint } = opInfo
                const opDetails = userOperationDetails[userOperationHash]

                // TODO: keep this metric
                //this.metrics.userOperationInclusionDuration.observe(
                //    (Date.now() - firstSubmitted) / 1000
                //)
                this.mempool.removeSubmitted(userOperationHash)
                this.reputationManager.updateUserOperationIncludedStatus(
                    userOperation,
                    entryPoint,
                    opDetails.accountDeployed
                )
                if (opDetails.status === "succesful") {
                    this.eventManager.emitIncludedOnChain(
                        userOperationHash,
                        transactionHash,
                        blockNumber as bigint
                    )
                } else {
                    this.eventManager.emitExecutionRevertedOnChain(
                        userOperationHash,
                        transactionHash,
                        opDetails.revertReason || "0x",
                        blockNumber as bigint
                    )
                }
                this.monitor.setUserOperationStatus(userOperationHash, {
                    status: "included",
                    transactionHash
                })
                this.logger.info(
                    {
                        userOperationHash,
                        transactionHash
                    },
                    "user op included"
                )
            })

            this.senderManager.markWalletProcessed(transactionInfo.executor)
        } else if (
            bundlingStatus.status === "reverted" &&
            bundlingStatus.isAA95
        ) {
            // resubmit with more gas when bundler encounters AA95
            transactionInfo.transactionRequest.gas = scaleBigIntByPercent(
                transactionInfo.transactionRequest.gas,
                this.config.aa95GasMultiplier
            )
            transactionInfo.transactionRequest.nonce += 1

            await this.replaceTransaction(transactionInfo, "AA95")
        } else {
            await Promise.all(
                opInfos.map(({ userOperationHash }) => {
                    this.checkFrontrun({
                        userOperationHash,
                        transactionHash,
                        blockNumber
                    })
                })
            )

            opInfos.map(({ userOperationHash }) => {
                this.mempool.removeSubmitted(userOperationHash)
            })
            this.senderManager.markWalletProcessed(transactionInfo.executor)
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
                            status: "rejected",
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

    async refreshUserOperationStatuses(): Promise<void> {
        const ops = this.mempool.dumpSubmittedOps()

        const opEntryPointMap = new Map<Address, SubmittedUserOperation[]>()

        for (const op of ops) {
            if (!opEntryPointMap.has(op.userOperation.entryPoint)) {
                opEntryPointMap.set(op.userOperation.entryPoint, [])
            }
            opEntryPointMap.get(op.userOperation.entryPoint)?.push(op)
        }

        await Promise.all(
            this.config.entrypoints.map(async (entryPoint) => {
                const ops = opEntryPointMap.get(entryPoint)

                if (ops) {
                    const txs = getTransactionsFromUserOperationEntries(ops)

                    await Promise.all(
                        txs.map(async (txInfo) => {
                            await this.refreshTransactionStatus(
                                entryPoint,
                                txInfo
                            )
                        })
                    )
                } else {
                    this.logger.warn(
                        { entryPoint },
                        "no user operations for entry point"
                    )
                }
            })
        )
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
        await this.refreshUserOperationStatuses()

        // for all still not included check if needs to be replaced (based on gas price)
        const gasPriceParameters =
            await this.gasPriceManager.tryGetNetworkGasPrice()
        this.logger.trace(
            { gasPriceParameters },
            "fetched gas price parameters"
        )

        const transactionInfos = getTransactionsFromUserOperationEntries(
            this.mempool.dumpSubmittedOps()
        )

        await Promise.all(
            transactionInfos.map(async (txInfo) => {
                if (
                    txInfo.transactionRequest.maxFeePerGas >=
                        gasPriceParameters.maxFeePerGas &&
                    txInfo.transactionRequest.maxPriorityFeePerGas >=
                        gasPriceParameters.maxPriorityFeePerGas
                ) {
                    return
                }

                await this.replaceTransaction(txInfo, "gas_price")
            })
        )

        // for any left check if enough time has passed, if so replace
        const transactionInfos2 = getTransactionsFromUserOperationEntries(
            this.mempool.dumpSubmittedOps()
        )
        await Promise.all(
            transactionInfos2.map(async (txInfo) => {
                if (
                    Date.now() - txInfo.lastReplaced <
                    this.config.resubmitStuckTimeout
                ) {
                    return
                }

                await this.replaceTransaction(txInfo, "stuck")
            })
        )

        this.currentlyHandlingBlock = false
    }

    async replaceTransaction(
        txInfo: TransactionInfo,
        reason: string
    ): Promise<void> {
        let replaceResult: ReplaceTransactionResult | undefined = undefined

        try {
            replaceResult = await this.executor.replaceTransaction(txInfo)
        } finally {
            this.metrics.replacedTransactions
                .labels({ reason, status: replaceResult?.status || "failed" })
                .inc()
        }

        if (replaceResult.status === "failed") {
            this.logger.warn(
                { oldTxHash: txInfo.transactionHash, reason },
                "failed to replace transaction"
            )

            const droppedUserOperations = txInfo.userOperationInfos.map(
                (opInfo) => ({
                    userOperation: opInfo.userOperation,
                    reason: "Failed to replace transaction"
                })
            )
            this.dropUserOperations(droppedUserOperations)
            this.senderManager.markWalletProcessed(txInfo.executor)
            return
        }

        if (replaceResult.status === "potentially_already_included") {
            this.logger.info(
                { oldTxHash: txInfo.transactionHash, reason },
                "transaction potentially already included"
            )
            txInfo.timesPotentiallyIncluded += 1

            if (txInfo.timesPotentiallyIncluded >= 3) {
                txInfo.userOperationInfos.map((opInfo) => {
                    this.mempool.removeSubmitted(opInfo.userOperationHash)
                })
                const txSender = txInfo.executor
                this.senderManager.markWalletProcessed(txSender)
                this.logger.warn(
                    { oldTxHash: txInfo.transactionHash, reason },
                    "transaction potentially already included too many times, removing"
                )
            }

            return
        }

        const newTxInfo = replaceResult.transactionInfo

        const missingOps = txInfo.userOperationInfos.filter(
            (info) =>
                !newTxInfo.userOperationInfos
                    .map((ni) => ni.userOperationHash)
                    .includes(info.userOperationHash)
        )

        const matchingOps = txInfo.userOperationInfos.filter((info) =>
            newTxInfo.userOperationInfos
                .map((ni) => ni.userOperationHash)
                .includes(info.userOperationHash)
        )

        matchingOps.map((opInfo) => {
            this.mempool.replaceSubmitted(opInfo, newTxInfo)
        })

        missingOps.map((opInfo) => {
            this.mempool.removeSubmitted(opInfo.userOperationHash)
            this.logger.warn(
                {
                    oldTxHash: txInfo.transactionHash,
                    newTxHash: newTxInfo.transactionHash,
                    reason
                },
                "missing op in new tx"
            )
        })

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
        userOperations: UserOperation[],
        transactionInfo: TransactionInfo
    ) {
        userOperations.map((op) => {
            const opHash = this.getOpHash(op)

            this.mempool.markSubmitted(opHash, transactionInfo)

            this.monitor.setUserOperationStatus(opHash, {
                status: "submitted",
                transactionHash: transactionInfo.transactionHash
            })

            this.startWatchingBlocks(this.handleBlock.bind(this))
            this.metrics.userOperationsSubmitted
                .labels({ status: "success" })
                .inc()
        })
    }

    resubmitUserOperations(
        userOperations: UserOperation[],
        entryPoint: Address,
        reason: string
    ) {
        userOperations.map((op) => {
            this.logger.info(
                {
                    userOpHash: this.getOpHash(op),
                    reason
                },
                "resubmitting user operation"
            )
            this.mempool.removeProcessing(this.getOpHash(op))
            this.mempool.add(op, entryPoint)
            this.metrics.userOperationsResubmitted.inc()
        })
    }

    dropUserOperations(rejectedUserOperations: RejectedUserOperation[]) {
        rejectedUserOperations.map(({ userOperation, reason }) => {
            const userOpHash = this.getOpHash(userOperation)
            this.mempool.removeProcessing(userOpHash)
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
