import type { SenderManager } from "@alto/executor"
import type { EventManager } from "@alto/handlers"
import type {
    InterfaceReputationManager,
    Mempool,
    Monitor
} from "@alto/mempool"
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

interface CachedReceipt {
    receipt: UserOperationReceipt
    timestamp: number
}

export class UserOpMonitor {
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
    private receiptCache: Map<HexData32, CachedReceipt> = new Map()
    private readonly receiptTtl = 5 * 60 * 1000 // 5 minutes

    constructor({
        config,
        mempool,
        monitor,
        metrics,
        reputationManager,
        eventManager,
        senderManager
    }: {
        config: AltoConfig
        mempool: Mempool
        monitor: Monitor
        metrics: Metrics
        reputationManager: InterfaceReputationManager
        eventManager: EventManager
        senderManager: SenderManager
    }) {
        this.reputationManager = reputationManager
        this.config = config
        this.mempool = mempool
        this.monitor = monitor
        this.metrics = metrics
        this.eventManager = eventManager
        this.senderManager = senderManager
        this.cachedLatestBlock = null
        this.logger = config.getLogger(
            { module: "userop_monitor" },
            {
                level: config.executorLogLevel || config.logLevel
            }
        )
    }

    getPendingBundles(): SubmittedBundleInfo[] {
        return Array.from(this.pendingBundles.values())
    }

    getReceipts(
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
        bundleReceipt
    }: {
        submittedBundle: SubmittedBundleInfo
        bundleReceipt: BundleStatus<"included">
    }) {
        const { bundle } = submittedBundle
        const { userOps, entryPoint } = bundle
        const { transactionHash, blockNumber, userOpReceipts } = bundleReceipt

        // Cleanup bundle
        await this.freeSubmittedBundle(submittedBundle)

        // Log metric
        this.metrics.userOpsOnChain
            .labels({ status: "included" })
            .inc(userOps.length)

        // Process each userOp
        // rest of the code is non-blocking
        return (async () => {
            for (const userOpInfo of userOps) {
                const userOpReceipt = userOpReceipts[userOpInfo.userOpHash]
                if (!userOpReceipt) {
                    throw new Error("userOpReceipt is undefined")
                }

                // Cache the receipt
                this.cacheReceipt(userOpInfo.userOpHash, userOpReceipt)

                await this.processIncludedUserOp(
                    userOpInfo,
                    userOpReceipt,
                    transactionHash,
                    blockNumber,
                    entryPoint
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
        bundleReceipt,
        block
    }: {
        submittedBundle: SubmittedBundleInfo
        bundleReceipt: BundleStatus<"reverted">
        block: Block
    }) {
        const { bundle } = submittedBundle
        const { blockNumber, transactionHash } = bundleReceipt

        await this.freeSubmittedBundle(submittedBundle)

        // make rest of the code non-blocking
        return (async () => {
            // Find userOps that can be resubmitted
            const filterOpsResult = await filterOpsAndEstimateGas({
                userOpBundle: bundle,
                config: this.config,
                logger: this.logger,
                networkBaseFee: block.baseFeePerGas || 0n
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
                const wasFrontrun = await this.checkFrontrun(userOpInfo)

                if (!wasFrontrun) {
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

    private cacheReceipt(userOpHash: Hex, receipt: UserOperationReceipt) {
        this.pruneReceiptCache()
        this.receiptCache.set(userOpHash, {
            receipt,
            timestamp: Date.now()
        })
    }

    private getCachedReceipt(
        userOpHash: Hex
    ): UserOperationReceipt | undefined {
        const cached = this.receiptCache.get(userOpHash)
        if (!cached) {
            return undefined
        }
        return cached.receipt
    }

    private pruneReceiptCache(): void {
        const now = Date.now()
        const expiredEntries = Array.from(this.receiptCache.entries()).filter(
            ([_, cached]) => now - cached.timestamp > this.receiptTtl
        )

        for (const [userOpHash] of expiredEntries) {
            this.receiptCache.delete(userOpHash)
        }
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
        userOpReceipt: any,
        transactionHash: Hash,
        blockNumber: bigint,
        entryPoint: Address
    ) {
        const { userOpHash, userOp, submissionAttempts, addedToMempool } =
            userOpInfo

        this.logger.info({ userOpHash, transactionHash }, "user op included")

        // Update status
        await this.monitor.setUserOpStatus(userOpHash, {
            status: "included",
            transactionHash
        })

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
        this.metrics.userOpInclusionDuration.observe(
            (Date.now() - addedToMempool) / 1000
        )
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

    async checkFrontrun(
        userOpInfo: UserOpInfo,
        blockWaitCount = 0
    ): Promise<boolean> {
        const { userOpHash } = userOpInfo

        // Try to find userOp onchain
        try {
            const userOpReceipt = await this.getUserOpReceipt(userOpHash)

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

                this.metrics.userOpsOnChain
                    .labels({ status: "frontran" })
                    .inc(1)

                return true
            }

            if (blockWaitCount >= this.config.maxBlockWaitCount) {
                return false
            }

            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve(this.checkFrontrun(userOpInfo, blockWaitCount + 1))
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

            return false
        }
    }

    async getUserOpReceipt(userOpHash: HexData32) {
        // Check cache first
        const cached = this.getCachedReceipt(userOpHash)
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
            while (true) {
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
                        continue
                    }

                    throw e
                }
            }
        }

        const receipt = await getTransactionReceipt(txHash)
        const userOpReceipt = parseUserOpReceipt(userOpHash, receipt)

        // Cache the receipt before returning
        this.cacheReceipt(userOpHash, userOpReceipt)

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
