import { type SenderManager, getUserOpHashes } from "@alto/executor"
import type { EventManager, GasPriceManager } from "@alto/handlers"
import type {
    InterfaceReputationManager,
    Mempool,
    StatusManager
} from "@alto/mempool"
import { type ReceiptCache, createReceiptCache } from "@alto/receiptCache"
import type {
    HexData32,
    IncludedBundleInfo,
    SubmittedBundleInfo,
    UserOpInfo,
    UserOperationReceipt
} from "@alto/types"
import { type Logger, type Metrics, parseUserOpReceipt } from "@alto/utils"
import * as sentry from "@sentry/node"
import {
    type Address,
    type Hash,
    type Hex,
    type TransactionReceipt,
    TransactionReceiptNotFoundError,
    decodeEventLog,
    getAbiItem,
    getAddress
} from "viem"
import { entryPoint07Abi } from "viem/account-abstraction"
import type { AltoConfig } from "../createConfig"
import { filterOpsAndEstimateGas } from "./filterOpsAndEstimateGas"
import { type BundleStatus, getBundleStatus } from "./getBundleStatus"

export class BundleManager {
    private readonly reputationManager: InterfaceReputationManager
    private readonly config: AltoConfig
    private readonly mempool: Mempool
    private readonly statusManager: StatusManager
    private readonly logger: Logger
    private readonly metrics: Metrics
    private readonly eventManager: EventManager
    private readonly senderManager: SenderManager
    private cachedLatestBlock: { value: bigint; timestamp: number } | null
    private readonly receiptCache: ReceiptCache
    private readonly gasPriceManager: GasPriceManager
    private readonly pendingBundles: Map<string, SubmittedBundleInfo> =
        new Map()
    // Included bundles awaiting their reorg check at confirmation depth.
    private readonly includedBundles: Map<string, IncludedBundleInfo> =
        new Map()

    constructor({
        config,
        mempool,
        statusManager,
        metrics,
        reputationManager,
        eventManager,
        senderManager,
        gasPriceManager
    }: {
        config: AltoConfig
        mempool: Mempool
        statusManager: StatusManager
        metrics: Metrics
        reputationManager: InterfaceReputationManager
        eventManager: EventManager
        senderManager: SenderManager
        gasPriceManager: GasPriceManager
    }) {
        this.reputationManager = reputationManager
        this.config = config
        this.mempool = mempool
        this.statusManager = statusManager
        this.metrics = metrics
        this.eventManager = eventManager
        this.senderManager = senderManager
        this.cachedLatestBlock = null
        this.gasPriceManager = gasPriceManager
        this.logger = config.getLogger(
            { module: "userop_status_manager" },
            {
                level: config.executorLogLevel || config.logLevel
            }
        )

        // Initialize receipt cache
        this.receiptCache = createReceiptCache(config, config.receiptCacheTtl)
    }

    getPendingBundles(): SubmittedBundleInfo[] {
        return Array.from(this.pendingBundles.values())
    }

    getBundleStatuses(
        pendingBundles: SubmittedBundleInfo[]
    ): Promise<BundleStatus[]> {
        return Promise.all(
            pendingBundles.map(async (bundle) => {
                try {
                    return await getBundleStatus({
                        submittedBundle: bundle,
                        publicClient: this.config.publicClient,
                        logger: this.logger
                    })
                } catch (err) {
                    sentry.captureException(err)
                    return {
                        status: "internal_error" as const,
                        error: err instanceof Error ? err.message : String(err)
                    }
                }
            })
        )
    }

    async processIncludedBundle({
        submittedBundle,
        bundleReceipt,
        blockReceivedTimestamp
    }: {
        submittedBundle: SubmittedBundleInfo
        bundleReceipt: BundleStatus<"included">
        blockReceivedTimestamp: number
    }) {
        const { uid, bundle } = submittedBundle
        const { userOps, entryPoint } = bundle
        const { transactionHash, blockNumber, blockHash, userOpReceipts } =
            bundleReceipt

        // Only watch for reorgs if reorg confirmation depth is set
        if (this.config.reorgConfirmationDepth > 0) {
            this.includedBundles.set(uid, {
                uid,
                userOpBundle: bundle,
                transactionHash,
                blockNumber,
                blockHash
            })
        }

        // Cleanup bundle
        await this.freeSubmittedBundle(submittedBundle)

        // Process all userOps in parallel (non-blocking)
        // The IIFE returns immediately, allowing the caller to continue
        return (async () => {
            const userOpsBatch = userOps.map((userOpInfo) => ({
                userOpInfo,
                userOpReceipt: userOpReceipts[userOpInfo.userOpHash]
            }))

            // Batch cache receipts
            const receipts = Object.values(userOpReceipts)
            await this.receiptCache.cache(receipts)

            // Batch process userOps
            await this.processIncludedUserOps(
                userOpsBatch,
                transactionHash,
                blockNumber,
                entryPoint,
                blockReceivedTimestamp
            )
        })()
    }

    hasIncludedBundles(): boolean {
        return this.includedBundles.size > 0
    }

    // Verifies each included bundle once, when its inclusion is
    // reorg-confirmation-depth blocks deep.
    async checkIncludedBundles({
        blockNumber,
        blockReceivedTimestamp
    }: {
        blockNumber?: bigint
        blockReceivedTimestamp: number
    }): Promise<void> {
        if (this.includedBundles.size === 0) {
            return
        }

        // Depth is measured against the head, so skipped block events only
        // delay the check. Head staleness is bounded by blockTime (the
        // default 15s cache TTL would delay checks by several blocks).
        const headBlockNumber =
            blockNumber ??
            (await this.getLatestBlockWithCache({
                maxAge: this.config.blockTime
            }).catch((err) => {
                this.logger.warn(
                    { err },
                    "failed to fetch head for reorg check, retrying next block"
                )
                return 0n
            }))
        const confirmationDepth = BigInt(this.config.reorgConfirmationDepth)

        for (const includedBundle of this.includedBundles.values()) {
            if (
                headBlockNumber - includedBundle.blockNumber >=
                confirmationDepth
            ) {
                this.verifyIncludedBundle({
                    includedBundle,
                    blockReceivedTimestamp
                })
            }
        }
    }

    // Re-checks a bundle's receipt at confirmation depth. Untracks
    // synchronously, so it never runs twice.
    private verifyIncludedBundle({
        includedBundle,
        blockReceivedTimestamp
    }: {
        includedBundle: IncludedBundleInfo
        blockReceivedTimestamp: number
    }) {
        this.includedBundles.delete(includedBundle.uid)
        const { transactionHash, blockNumber, blockHash, userOpBundle } =
            includedBundle

        // Fire and forget.
        ;(async () => {
            // A missing receipt is the reorg signal. Any other RPC failure
            // throws: the check is logged and dropped rather than retried.
            let receipt: TransactionReceipt | null = null
            try {
                receipt = await this.config.publicClient.getTransactionReceipt({
                    hash: transactionHash
                })
            } catch (err) {
                if (!(err instanceof TransactionReceiptNotFoundError)) {
                    throw err
                }
            }

            if (!receipt || receipt.status === "reverted") {
                // Gone (or reorged into a revert): the inclusion was orphaned.
                await this.recoverReorgedBundle({
                    includedBundle,
                    blockReceivedTimestamp
                })
                return
            }
            const minedReceipt = receipt

            // blockNumber is the settle signal. blockHash alone is not:
            // flashblocks endpoints (all Base public RPCs) serve
            // preconfirmation receipts whose blockHash is provisional (zero
            // or mutating) until the block seals, so the anchored hash
            // mismatches the sealed one on virtually every bundle.
            if (minedReceipt.blockNumber === blockNumber) {
                if (minedReceipt.blockHash !== blockHash) {
                    // Anchored pre-seal: refresh the cached receipts with
                    // the sealed data already in hand.
                    await this.receiptCache.cache(
                        userOpBundle.userOps.map(({ userOpHash }) =>
                            parseUserOpReceipt(userOpHash, minedReceipt)
                        )
                    )
                }
                return
            }

            // Re-mined into a different block after a reorg.
            this.logger.warn(
                {
                    transactionHash: minedReceipt.transactionHash,
                    fromBlockNumber: blockNumber.toString(),
                    toBlockNumber: minedReceipt.blockNumber.toString(),
                    userOpHashes: getUserOpHashes(userOpBundle.userOps)
                },
                "bundle re-mined after reorg"
            )

            const userOpReceipts = userOpBundle.userOps.map(({ userOpHash }) =>
                parseUserOpReceipt(userOpHash, minedReceipt)
            )
            await this.receiptCache.cache(userOpReceipts)
            await this.statusManager.set(
                getUserOpHashes(userOpBundle.userOps),
                {
                    status: "included",
                    transactionHash: minedReceipt.transactionHash
                }
            )
            for (const userOpReceipt of userOpReceipts) {
                if (userOpReceipt.success) {
                    this.eventManager.emitIncludedOnChain(
                        userOpReceipt.userOpHash,
                        minedReceipt.transactionHash,
                        minedReceipt.blockNumber
                    )
                } else {
                    this.eventManager.emitExecutionRevertedOnChain(
                        userOpReceipt.userOpHash,
                        minedReceipt.transactionHash,
                        userOpReceipt.reason || "0x",
                        minedReceipt.blockNumber
                    )
                }
            }
        })().catch((err) => {
            sentry.captureException(err)
            this.logger.error(
                {
                    err,
                    transactionHash: transactionHash,
                    userOpHashes: getUserOpHashes(
                        includedBundle.userOpBundle.userOps
                    )
                },
                "failed to verify included bundle at confirmation depth"
            )
        })
    }

    // Probes each userOp for a rival inclusion (getUserOpStatus's internal
    // retry doubles as the re-mine grace window) and resubmits the gone ones.
    private async recoverReorgedBundle({
        includedBundle,
        blockReceivedTimestamp
    }: {
        includedBundle: IncludedBundleInfo
        blockReceivedTimestamp: number
    }) {
        const { userOpBundle, transactionHash, blockNumber } = includedBundle
        const { entryPoint, userOps } = userOpBundle

        this.logger.warn(
            {
                orphanedTransactionHash: transactionHash,
                orphanedBlockNumber: blockNumber.toString(),
                userOpHashes: getUserOpHashes(userOps)
            },
            "included bundle orphaned by reorg, recovering"
        )

        // Drop stale receipts so the probes below read the canonical chain.
        await this.receiptCache.remove(getUserOpHashes(userOps))

        // Only the included tx is tracked as ours: an op that re-mined via an
        // older replacement sibling gets labeled "frontran" instead, and one
        // that slips past the probe fails simulation at resubmission.
        const bundlerTxs = [transactionHash]

        const results = await Promise.all(
            userOps.map(async (userOpInfo) => ({
                userOpInfo,
                status: await this.getUserOpStatus({
                    userOpInfo,
                    entryPoint,
                    bundlerTxs,
                    blockReceivedTimestamp
                })
            }))
        )

        const goneUserOps = results
            .filter(({ status }) => status === "not_found")
            .map(({ userOpInfo }) => userOpInfo)

        if (goneUserOps.length === 0) {
            return
        }

        for (const { userOpHash } of goneUserOps) {
            this.eventManager.emitReorgedOnChain(
                userOpHash,
                transactionHash,
                blockNumber
            )
        }
        this.metrics.userOpsOnChain
            .labels({ status: "reorged" })
            .inc(goneUserOps.length)

        this.logger.warn(
            {
                orphanedTransactionHash: transactionHash,
                userOpHashes: getUserOpHashes(goneUserOps)
            },
            "resubmitting reorged userOps"
        )

        // mempool.add resets the stale "included" status.
        await this.mempool.resubmitUserOps({
            userOps: goneUserOps,
            entryPoint,
            reason: "reorged"
        })
    }

    /**
     * The reasons for reverted bundles are:
     * 1. complete bundle was frontrun
     *    - cancel bundle
     *    - need to wait for one more block to see if the userOp was frontrun
     *
     * 2. partial bundle was frontrun
     *    - filter out non-frontrun userOps and resubmit
     *    - need to wait for one more block to see if the userOp was frontrun
     *
     * 3. partial bundle was reverted
     *    - filter out reverted userOps and resubmit
     *
     * 4. full bundle was reverted
     *    - cancel bundle
     *    - need to wait for one more block to see if the userOp was frontrun
     */
    async processRevertedBundle({
        submittedBundle,
        blockReceivedTimestamp,
        bundleReceipt
    }: {
        submittedBundle: SubmittedBundleInfo
        blockReceivedTimestamp: number
        bundleReceipt: BundleStatus<"reverted">
    }) {
        const { bundle } = submittedBundle
        const { blockNumber, transactionHash } = bundleReceipt

        this.logger.info(
            { transactionHash, userOpHashes: getUserOpHashes(bundle.userOps) },
            "Processing reverted bundle"
        )

        await this.freeSubmittedBundle(submittedBundle)

        const networkBaseFee = this.config.legacyTransactions
            ? 0n
            : await this.gasPriceManager.getBaseFee()

        // make rest of the code non-blocking
        return (async () => {
            // Find userOps that can be resubmitted
            const filterOpsResult = await filterOpsAndEstimateGas({
                checkEip7702AuthNonces: true, // Check if any userOps reverted onchain due to invalid EIP-7702 auth nonce.
                userOpBundle: bundle,
                config: this.config,
                logger: this.logger,
                networkBaseFee
            })

            // Resubmit any userOps that we can recover
            if (filterOpsResult.status === "success") {
                const { userOpsToBundle } = filterOpsResult

                await this.mempool.resubmitUserOps({
                    userOps: userOpsToBundle,
                    entryPoint: bundle.entryPoint,
                    reason: "sibling_op_reverted"
                })
            }

            const { rejectedUserOps } = filterOpsResult

            // Fire and forget
            // Check if any rejected userOps were frontruns, if not mark as reverted onchain.
            for (const userOpInfo of rejectedUserOps) {
                ;(async () => {
                    const status = await this.getUserOpStatus({
                        userOpInfo,
                        entryPoint: submittedBundle.bundle.entryPoint,
                        bundlerTxs: [
                            submittedBundle.transactionHash,
                            ...submittedBundle.previousTransactionHashes
                        ],
                        blockReceivedTimestamp
                    })

                    if (status === "not_found") {
                        const { userOpHash } = userOpInfo

                        await this.statusManager.set([userOpHash], {
                            status: "failed",
                            transactionHash
                        })

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

                        this.metrics.userOpsOnChain
                            .labels({ status: "reverted" })
                            .inc(1)
                    }
                })()
            }
        })()
    }

    async processInternalErrorBundle({
        submittedBundle,
        error
    }: {
        submittedBundle: SubmittedBundleInfo
        error: string
    }) {
        const { bundle, transactionHash } = submittedBundle
        const { userOps } = bundle

        this.logger.error(
            {
                transactionHash,
                userOpHashes: getUserOpHashes(userOps),
                error
            },
            "Internal error processing bundle - cleaning up and dropping"
        )

        // Clean up the bundle so it doesn't get stuck
        await this.freeSubmittedBundle(submittedBundle)

        // Mark all userOps as failed
        await this.statusManager.set(
            userOps.map((op) => op.userOpHash),
            {
                status: "failed",
                transactionHash
            }
        )

        // Increment metrics for failed userOps
        this.metrics.userOpsOnChain
            .labels({ status: "internal_error" })
            .inc(userOps.length)
    }

    public trackBundle(submittedBundle: SubmittedBundleInfo) {
        this.pendingBundles.set(submittedBundle.uid, submittedBundle)
    }

    // Helpers //
    async getLatestBlockWithCache(
        { maxAge }: { maxAge: number } = {
            maxAge: this.config.blockNumberCacheTtl
        }
    ): Promise<bigint> {
        const now = Date.now()
        const cache = this.cachedLatestBlock

        if (cache && now - cache.timestamp < maxAge) {
            return cache.value
        }

        const latestBlock = await this.config.publicClient.getBlockNumber()
        this.cachedLatestBlock = { value: latestBlock, timestamp: now }
        return latestBlock
    }

    // Free executors and remove userOps from mempool.
    private async freeSubmittedBundle(submittedBundle: SubmittedBundleInfo) {
        const { executor, bundle } = submittedBundle
        const { userOps, entryPoint } = bundle

        this.stopTrackingBundle(submittedBundle)
        await this.senderManager.markWalletProcessed(executor)
        await this.mempool.removeProcessing({ entryPoint, userOps })
    }

    // Stop tracking bundle in event resubmit fails
    public stopTrackingBundle(submittedBundle: SubmittedBundleInfo) {
        this.pendingBundles.delete(submittedBundle.uid)
    }

    private async processIncludedUserOps(
        userOpsBatch: {
            userOpInfo: UserOpInfo
            userOpReceipt: UserOperationReceipt
        }[],
        transactionHash: Hash,
        blockNumber: bigint,
        entryPoint: Address,
        blockReceivedTimestamp: number
    ) {
        // Update all statuses in one batch
        await this.statusManager.set(
            userOpsBatch.map(({ userOpInfo }) => userOpInfo.userOpHash),
            {
                status: "included",
                transactionHash
            }
        )

        // Process each userOp
        for (const { userOpInfo, userOpReceipt } of userOpsBatch) {
            const { userOpHash, userOp, submissionAttempts, addedToMempool } =
                userOpInfo

            const inclusionTimeMs = blockReceivedTimestamp - addedToMempool
            this.logger.info(
                { userOpHash, transactionHash, inclusionTimeMs },
                "user op included"
            )

            // Log metric
            this.metrics.userOpsOnChain.labels({ status: "included" }).inc()

            // Emit appropriate event
            if (userOpReceipt.success) {
                this.eventManager.emitIncludedOnChain(
                    userOpHash,
                    transactionHash,
                    blockNumber
                )
            } else {
                this.eventManager.emitExecutionRevertedOnChain(
                    userOpHash,
                    transactionHash,
                    userOpReceipt.reason || "0x",
                    blockNumber
                )
            }

            // Track metrics
            this.metrics.userOpInclusionDuration.observe(inclusionTimeMs / 1000)
            this.metrics.userOpsSubmissionAttempts.observe(submissionAttempts)

            // Update reputation
            const accountDeployed = this.checkAccountDeployment(
                userOpReceipt,
                userOp.sender
            )
            this.reputationManager.updateUserOpIncludedStatus(
                userOp,
                entryPoint,
                accountDeployed
            )
        }
    }

    async getUserOpStatus({
        userOpInfo,
        entryPoint,
        bundlerTxs,
        blockReceivedTimestamp,
        blockWaitCount = 0
    }: {
        userOpInfo: UserOpInfo
        entryPoint: Address
        bundlerTxs: Hex[]
        blockReceivedTimestamp: number
        blockWaitCount?: number
    }): Promise<"not_found" | "included" | "frontran"> {
        const { userOpHash } = userOpInfo

        // Try to find userOp onchain
        try {
            const userOpReceipt = await this.getUserOpReceipt(userOpHash)

            if (
                userOpReceipt &&
                bundlerTxs.includes(userOpReceipt.receipt.transactionHash)
            ) {
                const { receipt } = userOpReceipt
                const { blockNumber, transactionHash } = receipt

                // Cache the receipt
                await this.receiptCache.cache([userOpReceipt])

                await this.processIncludedUserOps(
                    [{ userOpInfo, userOpReceipt }],
                    transactionHash,
                    blockNumber,
                    entryPoint,
                    blockReceivedTimestamp
                )

                // userOp was bundled by this bundler
                return "included"
            }

            if (userOpReceipt) {
                const transactionHash = userOpReceipt.receipt.transactionHash
                const blockNumber = userOpReceipt.receipt.blockNumber

                await this.statusManager.set([userOpHash], {
                    status: "included",
                    transactionHash
                })

                this.eventManager.emitFrontranOnChain(
                    userOpHash,
                    transactionHash,
                    blockNumber
                )

                this.logger.info(
                    {
                        userOpHash
                    },
                    "user op frontrun onchain"
                )

                // Update metrics
                this.metrics.userOpsOnChain.labels({ status: "frontran" }).inc()

                // userOp was bundled by another bundler
                return "frontran"
            }

            if (blockWaitCount >= this.config.maxBlockWaitCount) {
                return "not_found"
            }

            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve(
                        this.getUserOpStatus({
                            userOpInfo,
                            entryPoint,
                            bundlerTxs,
                            blockReceivedTimestamp,
                            blockWaitCount: blockWaitCount + 1
                        })
                    )
                }, this.config.blockTime)
            })
        } catch (err) {
            this.logger.error(
                {
                    err,
                    userOpHash
                },
                "Error checking frontrun status"
            )

            return "not_found"
        }
    }

    async getUserOpReceipt(userOpHash: HexData32) {
        // Check cache first
        const cached = await this.receiptCache.get(userOpHash)
        if (cached) {
            return cached
        }

        let fromBlock: bigint | undefined
        let toBlock: "latest" | undefined
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
            event: getAbiItem({
                abi: entryPoint07Abi,
                name: "UserOperationEvent"
            }),
            fromBlock,
            toBlock,
            args: {
                userOpHash
            }
        })

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
            const maxRetries = 16

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const publicClient = this.config.publicClient

                    const transactionReceipt =
                        await publicClient.getTransactionReceipt({
                            hash: txHash
                        })

                    let effectiveGasPrice: bigint | undefined =
                        transactionReceipt.effectiveGasPrice ??
                        (transactionReceipt as any).gasPrice ??
                        undefined

                    if (effectiveGasPrice === undefined) {
                        const tx = await publicClient.getTransaction({
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
                        if (attempt < maxRetries - 1) {
                            // Wait a bit before trying again
                            await new Promise((resolve) =>
                                setTimeout(resolve, this.config.blockTime / 4)
                            )
                            continue
                        }

                        // Max retries reached, likely a reorg
                        throw new Error(
                            `Transaction receipt not found after ${maxRetries} attempts for tx ${txHash}`
                        )
                    }

                    throw e
                }
            }

            // Should never reach here due to the throw in the catch block
            throw new Error(`Failed to get transaction receipt for ${txHash}`)
        }

        const receipt = await getTransactionReceipt(txHash)
        const userOpReceipt = parseUserOpReceipt(userOpHash, receipt)

        // Cache the receipt before returning
        await this.receiptCache.cache([userOpReceipt])

        return userOpReceipt
    }

    private checkAccountDeployment(
        userOpReceipt: any,
        sender: Address
    ): boolean {
        return userOpReceipt.receipt.logs.some((log: any) => {
            try {
                const { args } = decodeEventLog({
                    abi: entryPoint07Abi,
                    data: log.data,
                    eventName: "AccountDeployed",
                    topics: log.topics as [Hex, ...Hex[]]
                })
                return getAddress(args.sender) === sender
            } catch {
                return false
            }
        })
    }
}
