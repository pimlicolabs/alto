import { UserOperation, SubmittedUserOperation, TransactionInfo } from "@alto/types"
import { Mempool, Monitor } from "@alto/mempool"
import { IExecutor } from "./executor"
import { Address, Block, Chain, PublicClient, Transport, WatchBlocksReturnType } from "viem"
import { Logger, Metrics, transactionIncluded } from "@alto/utils"
import { getGasPrice } from "@alto/utils"

function getTransactionsFromUserOperationEntries(entries: SubmittedUserOperation[]): TransactionInfo[] {
    return Array.from(
        new Set(
            entries.map((entry) => {
                return entry.transactionInfo
            })
        )
    )
}

export class ExecutorManager {
    private executor: IExecutor
    private mempool: Mempool
    private monitor: Monitor
    private publicClient: PublicClient<Transport, Chain>
    private entryPointAddress: Address
    private pollingInterval: number
    private logger: Logger
    private metrics: Metrics

    private unWatch: WatchBlocksReturnType | undefined
    private currentlyHandlingBlock = false

    constructor(
        executor: IExecutor,
        mempool: Mempool,
        monitor: Monitor,
        publicClient: PublicClient<Transport, Chain>,
        entryPointAddress: Address,
        pollingInterval: number,
        logger: Logger,
        metrics: Metrics
    ) {
        this.executor = executor
        this.mempool = mempool
        this.monitor = monitor
        this.publicClient = publicClient
        this.entryPointAddress = entryPointAddress
        this.pollingInterval = pollingInterval
        this.logger = logger
        this.metrics = metrics

        setInterval(async () => {
            await this.bundle()
        }, 1000)
    }

    async bundle() {
        const opsToBundle: UserOperation[][] = []
        // rome-ignore lint/nursery/noConstantCondition: <explanation>
        while (true) {
            const ops = this.mempool.process(5_000_000n, 1)
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
                const results = await this.executor.bundle(this.entryPointAddress, ops)

                for (const result of results) {
                    if (result.success === true) {
                        const res = result.value

                        this.mempool.markSubmitted(res.userOperation.userOperationHash, res.transactionInfo)
                        // this.monitoredTransactions.set(result.transactionInfo.transactionHash, result.transactionInfo)
                        this.monitor.setUserOperationStatus(res.userOperation.userOperationHash, {
                            status: "submitted",
                            transactionHash: res.transactionInfo.transactionHash
                        })

                        this.startWatchingBlocks(this.handleBlock.bind(this))
                    } else {
                        this.mempool.removeProcessing(result.error.userOpHash)
                        this.monitor.setUserOperationStatus(result.error.userOpHash, {
                            status: "rejected",
                            transactionHash: null
                        })
                        this.logger.warn(
                            { userOpHash: result.error.userOpHash, reason: result.error.reason },
                            "user operation rejected"
                        )
                    }
                }
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

    private async refreshTransactionStatus(transactionInfo: TransactionInfo) {
        const hashesToCheck = [transactionInfo.transactionHash, ...transactionInfo.previousTransactionHashes]

        const opInfos = transactionInfo.userOperationInfos
        // const opHashes = transactionInfo.userOperationInfos.map((opInfo) => opInfo.userOperationHash)

        const transactionStatuses = await Promise.all(
            hashesToCheck.map(async (hash) => {
                return {
                    hash: hash,
                    status: await transactionIncluded(hash, this.publicClient)
                }
            })
        )

        const status = transactionStatuses.find(
            (status) => status.status === "included" || status.status === "failed" || status.status === "reverted"
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

        if (status.status === "included") {
            opInfos.map((info) => {
                this.metrics.userOperationsIncluded.inc()
                this.metrics.userOperationInclusionDuration.observe((Date.now() - info.firstSubmitted) / 1000)
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
        } else if (status.status === "failed" || status.status === "reverted") {
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
                    "user op failed"
                )
            })

            this.executor.markWalletProcessed(transactionInfo.executor)
        }
    }

    async refreshUserOperationStatuses(): Promise<void> {
        const ops = this.mempool.dumpSubmittedOps()

        const txs = getTransactionsFromUserOperationEntries(ops)

        await Promise.all(
            txs.map(async (txInfo) => {
                await this.refreshTransactionStatus(txInfo)
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
        const gasPriceParameters = await getGasPrice(this.publicClient.chain.id, this.publicClient, this.logger)
        this.logger.trace({ gasPriceParameters }, "fetched gas price parameters")

        const transactionInfos = getTransactionsFromUserOperationEntries(this.mempool.dumpSubmittedOps())

        await Promise.all(
            transactionInfos.map(async (txInfo) => {
                if (
                    txInfo.transactionRequest.maxFeePerGas >= gasPriceParameters.maxFeePerGas &&
                    txInfo.transactionRequest.maxPriorityFeePerGas >= gasPriceParameters.maxPriorityFeePerGas
                ) {
                    return
                }

                await this.replaceTransaction(txInfo, "gas_price")
            })
        )

        // for any left check if enough time has passed, if so replace
        const transactionInfos2 = getTransactionsFromUserOperationEntries(this.mempool.dumpSubmittedOps())
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

    async replaceTransaction(txInfo: TransactionInfo, reason: string): Promise<void> {
        const replaceResult = await this.executor.replaceTransaction(txInfo)
        if (replaceResult.status === "failed") {
            txInfo.userOperationInfos.map((opInfo) => {
                this.mempool.removeSubmitted(opInfo.userOperationHash)
            })

            this.logger.warn({ oldTxHash: txInfo.transactionHash, reason }, "failed to replace transaction")

            return
        } else if (replaceResult.status === "potentially_already_included") {
            this.logger.info({ oldTxHash: txInfo.transactionHash, reason }, "transaction potentially already included")
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
            (info) => !newTxInfo.userOperationInfos.map((ni) => ni.userOperationHash).includes(info.userOperationHash)
        )
        const matchingOps = txInfo.userOperationInfos.filter((info) =>
            newTxInfo.userOperationInfos.map((ni) => ni.userOperationHash).includes(info.userOperationHash)
        )

        matchingOps.map((opInfo) => {
            this.mempool.replaceSubmitted(opInfo, newTxInfo)
        })

        missingOps.map((opInfo) => {
            this.mempool.removeSubmitted(opInfo.userOperationHash)
            this.logger.warn(
                { oldTxHash: txInfo.transactionHash, newTxHash: newTxInfo.transactionHash, reason },
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
