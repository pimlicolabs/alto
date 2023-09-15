import { UserOperation, SubmittedUserOperation, TransactionInfo } from "@alto/types"
import { Mempool, Monitor } from "@alto/mempool"
import { IExecutor } from "./executor"
import { Account, Address, Block, Chain, PublicClient, Transport, WatchBlocksReturnType } from "viem"
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

    async refreshUserOperationStatuses(): Promise<void> {
        const pushedWallets = new Set<Account>()

        const ops = this.mempool.dumpSubmittedOps()
        await Promise.all(
            ops.map(async (op) => {
                const status = await transactionIncluded(op.transactionInfo.transactionHash, this.publicClient)
                if (status === "included") {
                    this.metrics.userOperationsIncluded.inc()
                    this.metrics.userOperationInclusionDuration.observe(
                        (Date.now() - op.userOperation.firstSubmitted) / 1000
                    )

                    this.mempool.removeSubmitted(op.userOperation.userOperationHash)
                    this.monitor.setUserOperationStatus(op.userOperation.userOperationHash, {
                        status: "included",
                        transactionHash: op.transactionInfo.transactionHash
                    })
                    this.logger.info(
                        {
                            userOpHash: op.userOperation.userOperationHash,
                            transactionHash: op.transactionInfo.transactionHash
                        },
                        "user op included"
                    )
                    if (!pushedWallets.has(op.transactionInfo.executor)) {
                        this.executor.markWalletProcessed(op.transactionInfo.executor)
                    }
                } else if (status === "failed" || status === "reverted") {
                    this.mempool.removeSubmitted(op.userOperation.userOperationHash)
                    this.monitor.setUserOperationStatus(op.userOperation.userOperationHash, {
                        status,
                        transactionHash: op.transactionInfo.transactionHash
                    })
                    this.logger.info(
                        {
                            userOpHash: op.userOperation.userOperationHash,
                            transactionHash: op.transactionInfo.transactionHash
                        },
                        "user op failed"
                    )
                    if (!pushedWallets.has(op.transactionInfo.executor)) {
                        this.executor.markWalletProcessed(op.transactionInfo.executor)
                    }
                } else {
                    this.logger.trace(
                        {
                            userOpHash: op.userOperation.userOperationHash,
                            transactionHash: op.transactionInfo.transactionHash
                        },
                        "user op still pending"
                    )
                }
            })
        )
    }

    async handleBlock(block: Block) {
        this.logger.debug({ blockNumber: block.number }, "handling block")

        const submittedEntries = this.mempool.dumpSubmittedOps()
        if (submittedEntries.length === 0) {
            this.stopWatchingBlocks()
            return
        }

        // refresh op statuses
        await this.refreshUserOperationStatuses()

        // for all still not included check if needs to be replaced (based on gas price)
        const gasPriceParameters = await getGasPrice(this.publicClient.chain.id, this.publicClient, this.logger)
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
    }

    async replaceTransaction(txInfo: TransactionInfo, reason: string): Promise<void> {
        const replaceResult = await this.executor.replaceTransaction(txInfo)
        if (replaceResult.status === "failed") {
            txInfo.userOperationInfos.map((opInfo) => {
                this.mempool.removeSubmitted(opInfo.userOperationHash)
            })

            this.logger.warn({ oldTxHash: txInfo.transactionHash, reason }, "failed to replace transaction")

            return
        } else if (replaceResult.status === "not_needed") {
            this.logger.info({ oldTxHash: txInfo.transactionHash, reason }, "transaction does not need replacing")
            txInfo.userOperationInfos.map((opInfo) => {
                this.mempool.removeSubmitted(opInfo.userOperationHash)
            })

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
