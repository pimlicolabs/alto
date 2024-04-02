import type { Metrics, Logger, GasPriceManager } from "@alto/utils"
import type {
    InterfaceReputationManager,
    MemoryMempool,
    Monitor
} from "@alto/mempool"
import {
    type BundleResult,
    type BundlingMode,
    type HexData32,
    type MempoolUserOperation,
    type SubmittedUserOperation,
    type TransactionInfo,
    deriveUserOperation,
    isCompressedType,
    type UserOperation,
    type CompressedUserOperation,
    type UserOperationInfo
} from "@alto/types"
import { transactionIncluded } from "@alto/utils"
import type {
    Address,
    Block,
    Chain,
    Hash,
    PublicClient,
    Transport,
    WatchBlocksReturnType
} from "viem"
import type { Executor, ReplaceTransactionResult } from "./executor"

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

export class ExecutorManager {
    private entryPoints: Address[]
    private executor: Executor
    private mempool: MemoryMempool
    private monitor: Monitor
    private publicClient: PublicClient<Transport, Chain>
    private pollingInterval: number
    private logger: Logger
    private metrics: Metrics
    private reputationManager: InterfaceReputationManager
    private unWatch: WatchBlocksReturnType | undefined
    private currentlyHandlingBlock = false
    private timer?: NodeJS.Timer
    private bundlerFrequency: number
    private gasPriceManager: GasPriceManager

    constructor(
        executor: Executor,
        entryPoints: Address[],
        mempool: MemoryMempool,
        monitor: Monitor,
        reputationManager: InterfaceReputationManager,
        publicClient: PublicClient<Transport, Chain>,
        pollingInterval: number,
        logger: Logger,
        metrics: Metrics,
        bundleMode: BundlingMode,
        bundlerFrequency: number,
        gasPriceManager: GasPriceManager
    ) {
        this.entryPoints = entryPoints
        this.reputationManager = reputationManager
        this.executor = executor
        this.mempool = mempool
        this.monitor = monitor
        this.publicClient = publicClient
        this.pollingInterval = pollingInterval
        this.logger = logger
        this.metrics = metrics
        this.bundlerFrequency = bundlerFrequency
        this.gasPriceManager = gasPriceManager

        if (bundleMode === "auto") {
            this.timer = setInterval(async () => {
                await this.bundle()
            }, bundlerFrequency) as NodeJS.Timer
        }
    }

    setBundlingMode(bundleMode: BundlingMode): void {
        if (bundleMode === "auto" && !this.timer) {
            this.timer = setInterval(async () => {
                await this.bundle()
            }, this.bundlerFrequency) as NodeJS.Timer
        } else if (bundleMode === "manual" && this.timer) {
            clearInterval(this.timer)
            this.timer = undefined
        }
    }

    async bundleNow(): Promise<Hash[]> {
        const ops = await this.mempool.process(5_000_000n, 1)
        if (ops.length === 0) {
            throw new Error("no ops to bundle")
        }

        const opEntryPointMap = new Map<Address, MempoolUserOperation[]>()

        for (const op of ops) {
            if (!opEntryPointMap.has(op.entryPoint)) {
                opEntryPointMap.set(op.entryPoint, [])
            }
            opEntryPointMap.get(op.entryPoint)?.push(op.mempoolUserOperation)
        }

        const txHashes: Hash[] = []

        await Promise.all(
            this.entryPoints.map(async (entryPoint) => {
                const ops = opEntryPointMap.get(entryPoint)
                if (ops) {
                    const txHash = await this.sendToExecutor(entryPoint, ops)

                    if (!txHash) {
                        throw new Error("no tx hash")
                    }

                    txHashes.push(txHash)
                } else {
                    this.logger.warn(
                        { entryPoint },
                        "no user operations for entry point"
                    )
                }
            })
        )

        return txHashes
    }

    async sendToExecutor(
        entryPoint: Address,
        mempoolOps: MempoolUserOperation[]
    ) {
        const ops = mempoolOps
            .filter((op) => !isCompressedType(op))
            .map((op) => op as UserOperation)
        const compressedOps = mempoolOps
            .filter((op) => isCompressedType(op))
            .map((op) => op as CompressedUserOperation)

        const bundles: BundleResult[][] = []
        if (ops.length > 0) {
            bundles.push(await this.executor.bundle(entryPoint, ops))
        }
        if (compressedOps.length > 0) {
            bundles.push(
                await this.executor.bundleCompressed(entryPoint, compressedOps)
            )
        }

        for (const bundle of bundles) {
            const isBundleSuccess = bundle.every(
                (result) => result.status === "success"
            )
            if (isBundleSuccess) {
                this.metrics.bundlesSubmitted
                    .labels({ status: "success" })
                    .inc()
            } else {
                this.metrics.bundlesSubmitted.labels({ status: "failed" }).inc()
            }
        }

        const results = bundles.flat()

        const filteredOutOps = mempoolOps.length - results.length
        if (filteredOutOps > 0) {
            this.logger.debug(
                { filteredOutOps },
                "user operations filtered out"
            )
            this.metrics.userOperationsSubmitted
                .labels({ status: "filtered" })
                .inc(filteredOutOps)
        }

        let txHash: HexData32 | undefined = undefined
        for (const result of results) {
            if (result.status === "success") {
                const res = result.value

                this.mempool.markSubmitted(
                    res.userOperation.userOperationHash,
                    res.transactionInfo
                )
                // this.monitoredTransactions.set(result.transactionInfo.transactionHash, result.transactionInfo)
                this.monitor.setUserOperationStatus(
                    res.userOperation.userOperationHash,
                    {
                        status: "submitted",
                        transactionHash: res.transactionInfo.transactionHash
                    }
                )
                txHash = res.transactionInfo.transactionHash
                this.startWatchingBlocks(this.handleBlock.bind(this))
                this.metrics.userOperationsSubmitted
                    .labels({ status: "success" })
                    .inc()
            }
            if (result.status === "failure") {
                this.mempool.removeProcessing(result.error.userOpHash)
                this.monitor.setUserOperationStatus(result.error.userOpHash, {
                    status: "rejected",
                    transactionHash: null
                })
                this.logger.warn(
                    {
                        userOpHash: result.error.userOpHash,
                        reason: result.error.reason
                    },
                    "user operation rejected"
                )
                this.metrics.userOperationsSubmitted
                    .labels({ status: "failed" })
                    .inc()
            }
            if (result.status === "resubmit") {
                this.logger.info(
                    {
                        userOpHash: result.info.userOpHash,
                        reason: result.info.reason
                    },
                    "resubmitting user operation"
                )
                this.mempool.removeProcessing(result.info.userOpHash)
                this.mempool.add(
                    result.info.userOperation,
                    result.info.entryPoint
                )
                this.metrics.userOperationsResubmitted.inc()
            }
        }
        return txHash
    }

    async bundle() {
        const opsToBundle: UserOperationInfo[][] = []

        while (true) {
            const ops = await this.mempool.process(5_000_000n, 1)
            if (ops?.length > 0) {
                opsToBundle.push(ops)
            } else {
                break
            }
        }

        if (opsToBundle.length === 0) {
            return
        }

        await Promise.all(
            opsToBundle.map(async (ops) => {
                const opEntryPointMap = new Map<
                    Address,
                    MempoolUserOperation[]
                >()

                for (const op of ops) {
                    if (!opEntryPointMap.has(op.entryPoint)) {
                        opEntryPointMap.set(op.entryPoint, [])
                    }
                    opEntryPointMap
                        .get(op.entryPoint)
                        ?.push(op.mempoolUserOperation)
                }

                await Promise.all(
                    this.entryPoints.map(async (entryPoint) => {
                        const userOperations = opEntryPointMap.get(entryPoint)
                        if (userOperations) {
                            await this.sendToExecutor(
                                entryPoint,
                                userOperations
                            )
                        } else {
                            this.logger.warn(
                                { entryPoint },
                                "no user operations for entry point"
                            )
                        }
                    })
                )
            })
        )
    }

    startWatchingBlocks(handleBlock: (block: Block) => void): void {
        if (this.unWatch) {
            return
        }
        this.unWatch = this.publicClient.watchBlocks({
            onBlock: handleBlock,
            // onBlock: async (block) => {
            //     // Use an arrow function to ensure correct binding of `this`
            //     this.checkAndReplaceTransactions(block)
            //         .then(() => {
            //             this.logger.trace("block handled")
            //             // Handle the resolution of the promise here, if needed
            //         })
            //         .catch((error) => {
            //             // Handle any errors that occur during the execution of the promise
            //             this.logger.error({ error }, "error while handling block")
            //         })
            // },
            onError: (error) => {
                this.logger.error({ error }, "error while watching blocks")
            },
            emitMissed: false,
            includeTransactions: false,
            pollingInterval: this.pollingInterval
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

    private async refreshTransactionStatus(
        entryPoint: Address,
        transactionInfo: TransactionInfo
    ) {
        const hashesToCheck = [
            transactionInfo.transactionHash,
            ...transactionInfo.previousTransactionHashes
        ]

        const opInfos = transactionInfo.userOperationInfos
        // const opHashes = transactionInfo.userOperationInfos.map((opInfo) => opInfo.userOperationHash)

        const transactionStatuses = await Promise.all(
            hashesToCheck.map(async (hash) => {
                return {
                    hash: hash,
                    transactionStatuses: await transactionIncluded(
                        transactionInfo.isVersion06,
                        hash,
                        this.publicClient,
                        entryPoint
                    )
                }
            })
        )

        const status = transactionStatuses.find(
            (status) =>
                status.transactionStatuses.status === "included" ||
                status.transactionStatuses.status === "failed" ||
                status.transactionStatuses.status === "reverted"
        )

        if (!status) {
            opInfos.map((info) => {
                this.logger.trace(
                    {
                        userOpHash: info.userOperationHash,
                        transactionHash: transactionInfo.transactionHash
                    },
                    "user op still pending"
                )
            })

            return
        }

        this.metrics.userOperationsOnChain
            .labels({ status: status.transactionStatuses.status })
            .inc(opInfos.length)
        if (status.transactionStatuses.status === "included") {
            opInfos.map((info) => {
                this.metrics.userOperationInclusionDuration.observe(
                    (Date.now() - info.firstSubmitted) / 1000
                )
                this.reputationManager.updateUserOperationIncludedStatus(
                    deriveUserOperation(info.mempoolUserOperation),
                    info.entryPoint,
                    status.transactionStatuses[info.userOperationHash]
                        .accountDeployed
                )
                this.mempool.removeSubmitted(info.userOperationHash)
                this.monitor.setUserOperationStatus(info.userOperationHash, {
                    status: "included",
                    transactionHash: status.hash
                })
                this.logger.info(
                    {
                        userOpHash: info.userOperationHash,
                        transactionHash: status.hash
                    },
                    "user op included"
                )
            })

            this.executor.markWalletProcessed(transactionInfo.executor)
        } else if (
            status.transactionStatuses.status === "failed" ||
            status.transactionStatuses.status === "reverted"
        ) {
            opInfos.map((info) => {
                this.mempool.removeSubmitted(info.userOperationHash)
                this.monitor.setUserOperationStatus(info.userOperationHash, {
                    status: "rejected",
                    transactionHash: status.hash
                })
                this.logger.info(
                    {
                        userOpHash: info.userOperationHash,
                        transactionHash: status.hash
                    },
                    "user op rejected"
                )
            })

            this.executor.markWalletProcessed(transactionInfo.executor)
        }
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
            this.entryPoints.map(async (entryPoint) => {
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
        const gasPriceParameters = await this.gasPriceManager.getGasPrice()
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
                if (Date.now() - txInfo.lastReplaced < 5 * 60 * 1000) {
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
            txInfo.userOperationInfos.map((opInfo) => {
                this.mempool.removeSubmitted(opInfo.userOperationHash)
            })

            this.logger.warn(
                { oldTxHash: txInfo.transactionHash, reason },
                "failed to replace transaction"
            )

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
                this.executor.markWalletProcessed(txInfo.executor)

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
}
