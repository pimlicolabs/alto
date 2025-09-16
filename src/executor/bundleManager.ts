import type { SenderManager } from "@alto/executor"
import type { EventManager, GasPriceManager } from "@alto/handlers"
import type {
    InterfaceReputationManager,
    Mempool,
    Monitor
} from "@alto/mempool"
import type { ReceiptCache } from "@alto/receiptCache"
import { createReceiptCache } from "@alto/receiptCache"
import type { HexData32, SubmittedBundleInfo, UserOpInfo } from "@alto/types"
import type { UserOperationReceipt } from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import { parseUserOpReceipt } from "@alto/utils"
import {
    type Address,
    type Block,
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
    private reputationManager: InterfaceReputationManager
    private config: AltoConfig
    private mempool: Mempool
    private monitor: Monitor
    private logger: Logger
    private metrics: Metrics
    private eventManager: EventManager
    private senderManager: SenderManager
    private cachedLatestBlock: { value: bigint; timestamp: number } | null
    private pendingBundles: Map<string, SubmittedBundleInfo> = new Map()
    private receiptCache: ReceiptCache
    private gasPriceManager: GasPriceManager

    constructor({
        config,
        mempool,
        monitor,
        metrics,
        reputationManager,
        eventManager,
        senderManager,
        gasPriceManager
    }: {
        config: AltoConfig
        mempool: Mempool
        monitor: Monitor
        metrics: Metrics
        reputationManager: InterfaceReputationManager
        eventManager: EventManager
        senderManager: SenderManager
        gasPriceManager: GasPriceManager
    }) {
        this.reputationManager = reputationManager
        this.config = config
        this.mempool = mempool
        this.monitor = monitor
        this.metrics = metrics
        this.eventManager = eventManager
        this.senderManager = senderManager
        this.cachedLatestBlock = null
        this.gasPriceManager = gasPriceManager
        this.logger = config.getLogger(
            { module: "userop_monitor" },
            {
                level: config.executorLogLevel || config.logLevel
            }
        )

        // Initialize receipt cache
        this.receiptCache = createReceiptCache(
            config,
            1 * 60 * 1000 // 1 minutes TTL
        )
    }

    getPendingBundles(): SubmittedBundleInfo[] {
        return Array.from(this.pendingBundles.values())
    }

    getBundleStatuses(
        pendingBundles: SubmittedBundleInfo[]
    ): Promise<BundleStatus[]> {
        return Promise.all(
            pendingBundles.map((bundle) => {
                return getBundleStatus({
                    submittedBundle: bundle,
                    publicClient: this.config.publicClient,
                    logger: this.logger
                })
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
        const { bundle } = submittedBundle
        const { userOps, entryPoint } = bundle
        const { transactionHash, blockNumber, userOpReceipts } = bundleReceipt

        // Cleanup bundle
        await this.freeSubmittedBundle(submittedBundle)

        // Process each userOp
        // rest of the code is non-blocking
        return (async () => {
            for (const userOpInfo of userOps) {
                const userOpReceipt = userOpReceipts[userOpInfo.userOpHash]

                // Cache the receipt
                await this.receiptCache.set(
                    userOpInfo.userOpHash,
                    userOpReceipt
                )

                await this.processIncludedUserOp(
                    userOpInfo,
                    userOpReceipt,
                    transactionHash,
                    blockNumber,
                    entryPoint,
                    blockReceivedTimestamp
                )
            }
        })()
    }

    /**
     * The reasons for reverted bundles are:
     * 1. complete bundle was frontrun -> cancel bundle -> need to wait for one more block to see if the userOp was frontrun
     * 2. partial bundle was frontrun -> filter out non-frontrun userOps and resubmit -> need to wait for one more block to see if the userOp was frontrun
     * 3. partial bundle was reverted -> filter out reverted userOps and resubmit
     * 4. full bundle was reverted -> cancel bundle -> need to wait for one more block to see if the userOp was frontrun
     */
    async processRevertedBundle({
        submittedBundle,
        blockReceivedTimestamp,
        bundleReceipt,
        block
    }: {
        submittedBundle: SubmittedBundleInfo
        blockReceivedTimestamp: number
        bundleReceipt: BundleStatus<"reverted">
        block?: Block
    }) {
        const { bundle } = submittedBundle
        const { blockNumber, transactionHash } = bundleReceipt

        await this.freeSubmittedBundle(submittedBundle)

        const networkBaseFee = this.config.legacyTransactions
            ? 0n
            : (block?.baseFeePerGas ??
              (await this.gasPriceManager.getBaseFee()))

        // make rest of the code non-blocking
        return (async () => {
            // Find userOps that can be resubmitted
            const filterOpsResult = await filterOpsAndEstimateGas({
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
            rejectedUserOps.map(async (userOpInfo) => {
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

                    await this.monitor.setUserOpStatus(userOpHash, {
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
            })
        })()
    }

    public trackBundle(submittedBundle: SubmittedBundleInfo) {
        this.pendingBundles.set(submittedBundle.uid, submittedBundle)
    }

    // Helpers //
    async getLatestBlockWithCache(): Promise<bigint> {
        const now = Date.now()
        const cache = this.cachedLatestBlock

        if (cache && now - cache.timestamp < this.config.blockNumberCacheTtl) {
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
        await this.mempool.removeSubmittedUserOps({ entryPoint, userOps })
    }

    // Stop tracking bundle in event resubmit fails
    public stopTrackingBundle(submittedBundle: SubmittedBundleInfo) {
        this.pendingBundles.delete(submittedBundle.uid)
    }

    private async processIncludedUserOp(
        userOpInfo: UserOpInfo,
        userOpReceipt: UserOperationReceipt,
        transactionHash: Hash,
        blockNumber: bigint,
        entryPoint: Address,
        blockReceivedTimestamp: number
    ) {
        const { userOpHash, userOp, submissionAttempts, addedToMempool } =
            userOpInfo

        const inclusionTimeMs = blockReceivedTimestamp - addedToMempool
        this.logger.info(
            { userOpHash, transactionHash, inclusionTimeMs },
            "user op included"
        )

        // Update status
        await this.monitor.setUserOpStatus(userOpHash, {
            status: "included",
            transactionHash
        })

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
                await this.receiptCache.set(
                    userOpInfo.userOpHash,
                    userOpReceipt
                )

                await this.processIncludedUserOp(
                    userOpInfo,
                    userOpReceipt,
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

                await this.monitor.setUserOpStatus(userOpHash, {
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
                }, this.config.publicClient.chain.blockTime ?? 1_000)
            })
        } catch (error) {
            this.logger.error(
                {
                    userOpHash,
                    error
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
        await this.receiptCache.set(userOpHash, userOpReceipt)

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
