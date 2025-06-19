import type { EventManager } from "@alto/handlers"
import type { Mempool, Monitor } from "@alto/mempool"
import {
    EntryPointV06Abi,
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
    getAbiItem
} from "viem"
import type { AltoConfig } from "../createConfig"
import { SenderManager } from "./senderManager"
import { BundleIncluded, getBundleStatus } from "./getBundleStatus"

export class BundleMonitor {
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
        eventManager,
        senderManager
    }: {
        config: AltoConfig
        mempool: Mempool
        monitor: Monitor
        metrics: Metrics
        eventManager: EventManager
        senderManager: SenderManager
    }) {
        this.config = config
        this.mempool = mempool
        this.monitor = monitor
        this.metrics = metrics
        this.eventManager = eventManager
        this.senderManager = senderManager
        this.cachedLatestBlock = null
        this.logger = config.getLogger(
            { module: "bundle_monitor" },
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
            await this.markBundleIncluded({
                submittedBundle,
                bundleReceipt
            })
        }

        if (bundleReceipt.status === "reverted") {
            const { userOps, entryPoint } = submittedBundle.bundle
            const { blockNumber, transactionHash } = bundleReceipt
            await Promise.all(
                userOps.map(async (userOpInfo) => {
                    await this.checkFrontrun({
                        entryPoint,
                        userOpInfo,
                        transactionHash,
                        blockNumber
                    })
                })
            )
            await this.mempool.markUserOpsAsIncluded({
                entryPoint,
                userOpHashes: userOps.map(({ userOpHash }) => userOpHash)
            })
        }
    }

    async checkFrontrun({
        userOpInfo,
        entryPoint,
        transactionHash,
        blockNumber
    }: {
        userOpInfo: UserOpInfo
        transactionHash: Hash
        entryPoint: Address
        blockNumber: bigint
    }) {
        const { userOpHash } = userOpInfo
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

                            await this.mempool.markUserOpsAsIncluded({
                                entryPoint,
                                userOpHashes: [userOpHash]
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

    private async markBundleIncluded({
        submittedBundle,
        bundleReceipt
    }: {
        submittedBundle: SubmittedBundleInfo
        bundleReceipt: BundleIncluded
    }) {
        const { bundle, executor } = submittedBundle
        const { userOps, entryPoint } = bundle

        // Free executor.
        await this.senderManager.markWalletProcessed(executor)
        this.freePendingBundle(submittedBundle)

        await this.mempool.markUserOpsAsIncluded({
            userOps,
            bundleReceipt: bundleReceipt,
            entryPoint
        })
    }
}
