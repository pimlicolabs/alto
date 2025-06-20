import type { EventManager } from "@alto/handlers"
import type {
    InterfaceReputationManager,
    Mempool,
    Monitor
} from "@alto/mempool"
import {
    type HexData32,
    type SubmittedBundleInfo,
    UserOpInfo
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import { parseUserOperationReceipt } from "@alto/utils"
import {
    type Address,
    type Hash,
    type TransactionReceipt,
    TransactionReceiptNotFoundError,
    getAbiItem,
    Hex,
    decodeEventLog,
    getAddress
} from "viem"
import type { AltoConfig } from "../createConfig"
import { SenderManager } from "./senderManager"
import { getBundleStatus } from "./getBundleStatus"
import { entryPoint07Abi } from "viem/_types/account-abstraction"

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
    private pendingBundles: Map<Address, SubmittedBundleInfo> = new Map()

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

    async processBlock(blockNumber: bigint): Promise<SubmittedBundleInfo[]> {
        // Update the cached block number whenever we receive a new block.
        this.cachedLatestBlock = { value: blockNumber, timestamp: Date.now() }

        const pendingBundles = Array.from(this.pendingBundles.values())
        await Promise.all(pendingBundles.map(this.refreshBundleStatus))
        return pendingBundles
    }

    public setPendingBundle(submittedBundle: SubmittedBundleInfo) {
        const executor = submittedBundle.executor.address
        this.pendingBundles.set(executor, submittedBundle)
    }

    private freePendingBundle(submittedBundle: SubmittedBundleInfo) {
        const executor = submittedBundle.executor.address
        this.pendingBundles.delete(executor)
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

    async refreshBundleStatus(submittedBundle: SubmittedBundleInfo) {
        let bundleReceipt = await getBundleStatus({
            submittedBundle,
            publicClient: this.config.publicClient,
            logger: this.logger
        })

        if (bundleReceipt.status === "included") {
            const { bundle, executor } = submittedBundle
            const { userOps, entryPoint } = bundle
            const { transactionHash, blockNumber, userOpReceipts } =
                bundleReceipt

            // Free executor and remove userOp from mempool.
            this.freePendingBundle(submittedBundle)
            await this.senderManager.markWalletProcessed(executor)
            await this.mempool.removeSubmittedUserOps({
                entryPoint,
                userOps
            })

            // Log userOps onchain metric.
            this.metrics.userOperationsOnChain
                .labels({ status: "included" })
                .inc(userOps.length)

            await Promise.all(
                userOps.map(async (userOpInfo) => {
                    const {
                        userOpHash,
                        userOp,
                        submissionAttempts,
                        addedToMempool
                    } = userOpInfo

                    const userOpReceipt = userOpReceipts[userOpHash]
                    if (!userOpReceipt) {
                        throw new Error("userOpReceipt is undefined")
                    }

                    this.logger.info(
                        {
                            userOpHash,
                            transactionHash
                        },
                        "user op included"
                    )

                    // Update status and emit event
                    await this.monitor.setUserOperationStatus(userOpHash, {
                        status: "included",
                        transactionHash
                    })
                    if (userOpReceipt.success) {
                        this.eventManager.emitIncludedOnChain(
                            userOpHash,
                            transactionHash,
                            blockNumber
                        )
                    } else {
                        const revertReason = userOpReceipt.reason
                        this.eventManager.emitExecutionRevertedOnChain(
                            userOpHash,
                            transactionHash,
                            revertReason || "0x",
                            blockNumber
                        )
                    }

                    // Track inclusion metrics
                    this.metrics.userOperationInclusionDuration.observe(
                        (Date.now() - addedToMempool) / 1000
                    )
                    this.metrics.userOperationsSubmissionAttempts.observe(
                        submissionAttempts
                    )

                    // Update reputation manager
                    const accountDeployed = userOpReceipt.receipt.logs.some(
                        (log) => {
                            try {
                                const { args } = decodeEventLog({
                                    abi: entryPoint07Abi,
                                    data: log.data,
                                    eventName: "AccountDeployed",
                                    topics: log.topics as [Hex, ...Hex[]]
                                })
                                return getAddress(args.sender) === userOp.sender
                            } catch {
                                return false
                            }
                        }
                    )

                    this.reputationManager.updateUserOperationIncludedStatus(
                        userOp,
                        entryPoint,
                        accountDeployed
                    )
                })
            )
        }

        if (bundleReceipt.status === "reverted") {
            const { executor, bundle } = submittedBundle
            const { userOps, entryPoint } = bundle
            const { blockNumber, transactionHash } = bundleReceipt

            // Free executor and remove userOp from mempool.
            this.freePendingBundle(submittedBundle)
            await this.senderManager.markWalletProcessed(executor)
            await this.mempool.removeSubmittedUserOps({
                entryPoint,
                userOps
            })

            // Fire and forget
            Promise.all(
                userOps.map(async (userOpInfo) => {
                    this.checkFrontrun({
                        userOpInfo,
                        transactionHash,
                        blockNumber
                    })
                })
            )
        }
    }

    async checkFrontrun({
        userOpInfo,
        transactionHash,
        blockNumber
    }: {
        userOpInfo: UserOpInfo
        transactionHash: Hash
        blockNumber: bigint
    }) {
        const { userOpHash } = userOpInfo

        // Try to find userOp onchain
        try {
            const userOpReceipt = await this.getUserOpReceipt(userOpHash)

            if (userOpReceipt) {
                const transactionHash = userOpReceipt.receipt.transactionHash
                const blockNumber = userOpReceipt.receipt.blockNumber

                await this.monitor.setUserOperationStatus(userOpHash, {
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
                        userOpHash,
                        transactionHash
                    },
                    "user op frontrun onchain"
                )

                this.metrics.userOperationsOnChain
                    .labels({ status: "frontran" })
                    .inc(1)
            } else {
                await this.monitor.setUserOperationStatus(userOpHash, {
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
    }

    async getUserOpReceipt(userOperationHash: HexData32) {
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
            event: getAbiItem({
                abi: entryPoint07Abi,
                name: "UserOperationEvent"
            }),
            fromBlock,
            toBlock,
            args: {
                userOpHash: userOperationHash
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
        const userOperationReceipt = parseUserOperationReceipt(
            userOperationHash,
            receipt
        )

        return userOperationReceipt
    }
}
