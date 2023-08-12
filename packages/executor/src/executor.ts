import { EntryPointAbi, RpcError, errorCauseSchema } from "@alto/types"
import { Address, HexData32, UserOperation } from "@alto/types"
import { Logger, Metrics, calcPreVerificationGas } from "@alto/utils"
import { Mutex } from "async-mutex"
import {
    Abi,
    Account,
    Block,
    Chain,
    ContractFunctionExecutionError,
    ContractFunctionRevertedError,
    PublicClient,
    Transport,
    WalletClient,
    WatchBlocksReturnType,
    WriteContractParameters,
    getContract
} from "viem"
import { SenderManager } from "./senderManager"
import { Monitor } from "./monitoring"
import { fromZodError } from "zod-validation-error"
import { getGasPrice } from "./gasPrice"

export interface GasEstimateResult {
    preverificationGas: bigint
    verificationGasLimit: bigint
    callGasLimit: bigint
}

export interface IExecutor {
    bundle(_entryPoint: Address, _op: UserOperation): Promise<void>
    flushStuckTransactions(): Promise<void>
}

export class NullExecutor implements IExecutor {
    async flushStuckTransactions(): Promise<void> {}
    async bundle(_entryPoint: Address, _op: UserOperation): Promise<void> {}
}

interface UserOperationStatus {
    transactionHash: HexData32
    transactionRequest: WriteContractParameters<Abi | readonly unknown[], string, Chain, Account | undefined, Chain>
    executor: Account
}

const transactionIncluded = async (txHash: HexData32, publicClient: PublicClient): Promise<boolean> => {
    try {
        await publicClient.getTransactionReceipt({ hash: txHash })
        return true
    } catch (_e) {
        return false
    }
}

export class BasicExecutor implements IExecutor {
    monitoredTransactions: Record<HexData32, UserOperationStatus> = {}
    private unWatch: WatchBlocksReturnType | undefined

    beneficiary: Address
    publicClient: PublicClient
    walletClient: WalletClient<Transport, Chain, Account | undefined>
    senderManager: SenderManager
    monitor: Monitor
    entryPoint: Address
    pollingInterval: number
    logger: Logger
    metrics: Metrics
    simulateTransaction: boolean

    mutex: Mutex

    constructor(
        beneficiary: Address,
        publicClient: PublicClient,
        walletClient: WalletClient<Transport, Chain, Account | undefined>,
        senderManager: SenderManager,
        monitor: Monitor,
        entryPoint: Address,
        pollingInterval: number,
        logger: Logger,
        metrics: Metrics,
        simulateTransaction = false
    ) {
        this.beneficiary = beneficiary
        this.publicClient = publicClient
        this.walletClient = walletClient
        this.senderManager = senderManager
        this.monitor = monitor
        this.entryPoint = entryPoint
        this.pollingInterval = pollingInterval
        this.logger = logger
        this.metrics = metrics
        this.simulateTransaction = simulateTransaction

        this.mutex = new Mutex()
    }
    async flushStuckTransactions(): Promise<void> {
        const gasPrice = 10n * (await this.publicClient.getGasPrice())

        const wallets = [...this.senderManager.wallets, this.senderManager.utilityAccount]
        const promises = wallets.map(async (wallet) => {
            const latestNonce = await this.publicClient.getTransactionCount({
                address: wallet.address,
                blockTag: "latest"
            })
            const pendingNonce = await this.publicClient.getTransactionCount({
                address: wallet.address,
                blockTag: "pending"
            })

            this.logger.debug({ latestNonce, pendingNonce, wallet: wallet.address }, "checking for stuck transactions")

            // same nonce is okay
            if (latestNonce === pendingNonce) {
                return
            }

            // one nonce ahead is also okay
            if (latestNonce + 1 === pendingNonce) {
                return
            }

            this.logger.info({ latestNonce, pendingNonce, wallet: wallet.address }, "found stuck transaction, flushing")

            for (let nonceToFlush = latestNonce; nonceToFlush < pendingNonce; nonceToFlush++) {
                try {
                    const txHash = await this.walletClient.sendTransaction({
                        account: wallet,
                        to: wallet.address,
                        value: 0n,
                        nonce: nonceToFlush,
                        maxFeePerGas: gasPrice,
                        maxPriorityFeePerGas: gasPrice
                    })

                    this.logger.debug(
                        { txHash, nonce: nonceToFlush, wallet: wallet.address },
                        "flushed stuck transaction"
                    )

                    await transactionIncluded(txHash, this.publicClient)
                } catch (e) {
                    this.logger.warn({ error: e }, "error flushing stuck transaction")
                }
            }
        })

        await Promise.all(promises)
    }

    startWatchingBlocks(): void {
        if (this.unWatch) {
            return
        }
        this.unWatch = this.publicClient.watchBlocks({
            onBlock: async (block) => {
                // Use an arrow function to ensure correct binding of `this`
                this.checkAndReplaceTransactions(block)
                    .then(() => {
                        this.logger.trace("block handled")
                        // Handle the resolution of the promise here, if needed
                    })
                    .catch((error) => {
                        // Handle any errors that occur during the execution of the promise
                        this.logger.error({ error }, "error while handling block")
                    })
            },
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

    async checkAndReplaceTransactions(block: Block): Promise<void> {
        // typescript mistakenly doesn't believe this is HexData32
        // @ts-ignore
        const opHashes: HexData32[] = Object.keys(this.monitoredTransactions)

        this.logger.debug({ opHashes }, "checking transactions for monitored ops")

        if (Object.keys(this.monitoredTransactions).length === 0) {
            this.stopWatchingBlocks()
            return
        }

        const gasPriceParameters = await getGasPrice(this.walletClient.chain.id, this.publicClient, this.logger)

        opHashes.map(async (opHash) => {
            const opStatus = this.monitoredTransactions[opHash]
            if (opStatus === undefined) {
                this.logger.error({ opHash }, "opStatus is undefined")
                return
            }

            const txIncluded = await transactionIncluded(opStatus.transactionHash, this.publicClient)
            const childLogger = this.logger.child({
                userOpHash: opHash,
                txHash: opStatus.transactionHash,
                executor: opStatus.executor.address
            })
            if (txIncluded) {
                childLogger.info("transaction successfully included")
                delete this.monitoredTransactions[opHash]
                this.monitor.setUserOperationStatus(opHash, {
                    status: "included",
                    transactionHash: opStatus.transactionHash
                })
                this.senderManager.pushWallet(opStatus.executor)
                this.metrics.userOperationsBundlesIncluded.inc()
                return
            }

            childLogger.debug("transaction not included")

            const transaction = opStatus.transactionRequest
            childLogger.trace(
                { baseFeePerGas: block.baseFeePerGas, maxFeePerGas: transaction.maxFeePerGas },
                "queried gas fee parameters"
            )

            if (
                transaction.maxFeePerGas === undefined ||
                transaction.maxPriorityFeePerGas === undefined ||
                transaction.maxFeePerGas >= gasPriceParameters.maxFeePerGas
            ) {
                childLogger.debug(
                    { maxFeePerGas: transaction.maxFeePerGas, gasPriceParameters },
                    "gas price is high enough, not replacing transaction"
                )
                return
            }

            childLogger.debug("replacing transaction")
            delete this.monitoredTransactions[opHash]

            let request
            if (this.walletClient.chain.id !== 534353) {
                request = {
                    ...transaction,
                    maxFeePerGas:
                        gasPriceParameters.maxFeePerGas > (transaction.maxFeePerGas * 11n) / 10n
                            ? gasPriceParameters.maxFeePerGas
                            : (transaction.maxFeePerGas * 11n) / 10n,
                    maxPriorityFeePerGas: (transaction.maxPriorityFeePerGas * 11n) / 10n
                }
            } else {
                if (transaction.gasPrice === undefined) {
                    throw new Error("gas price is undefined")
                }
                request = {
                    ...transaction,
                    gasPrice:
                        gasPriceParameters.maxFeePerGas > (transaction.gasPrice * 11n) / 10n
                            ? gasPriceParameters.maxFeePerGas
                            : (transaction.gasPrice * 11n) / 10n
                }
            }

            const { chain: _chain, abi: _abi, ...loggingRequest } = request
            childLogger.trace({ request: { ...loggingRequest } }, "generated replacement transaction request")

            try {
                const tx = await this.walletClient.writeContract(request)
                this.monitoredTransactions[opHash] = {
                    transactionHash: tx,
                    transactionRequest: request,
                    executor: opStatus.executor
                }

                this.monitor.setUserOperationStatus(opHash, { status: "submitted", transactionHash: tx })

                childLogger.info(
                    {
                        txHash: tx,
                        oldTxHash: opStatus.transactionHash,
                        maxFeePerGas: request.maxFeePerGas,
                        oldMaxFeePerGas: transaction.maxFeePerGas,
                        maxPriorityFeePerGas: request.maxPriorityFeePerGas,
                        oldMaxPriorityFeePerGas: transaction.maxPriorityFeePerGas
                    },
                    "transaction successfully replaced"
                )
            } catch (e) {
                const pendingNonce = await this.publicClient.getTransactionCount({
                    address: opStatus.executor.address,
                    blockTag: "pending"
                })
                const latestNonce = await this.publicClient.getTransactionCount({
                    address: opStatus.executor.address,
                    blockTag: "latest"
                })

                // there is no pending tx in the mempool from this address, so wallet is safe to use
                if (pendingNonce === latestNonce) {
                    childLogger.warn(e, "error replacing transaction")
                    this.senderManager.pushWallet(opStatus.executor)
                    this.monitor.setUserOperationStatus(opHash, {
                        status: "failed",
                        transactionHash: opStatus.transactionHash
                    })
                } else {
                    childLogger.warn(e, "error replacing transaction, but wallet is busy")
                    this.monitoredTransactions[opHash] = opStatus
                }

                return
            }
        })
    }

    async bundle(entryPoint: Address, op: UserOperation): Promise<void> {
        const wallet = await this.senderManager.getWallet()

        const ep = getContract({
            abi: EntryPointAbi,
            address: entryPoint,
            publicClient: this.publicClient,
            walletClient: this.walletClient
        })

        const childLogger = this.logger.child({ userOperation: op, entryPoint })
        childLogger.debug("bundling user operation")

        try {
            const opHash = await ep.read.getUserOpHash([op])
            childLogger.debug({ opHash }, "got op hash")

            if (opHash in this.monitoredTransactions) {
                childLogger.debug({ opHash }, "user operation already being bundled")
                throw new RpcError(`user operation ${opHash} already being bundled`)
            }

            const chainId = this.walletClient.chain.id

            let gasLimit = ((op.preVerificationGas + 3n * op.verificationGasLimit + op.callGasLimit) * 12n) / 10n
            if (chainId === 42161) {
                gasLimit *= 8n
            } else if (chainId === 10 || chainId === 420 || chainId === 84531) {
                // gasLimit = await ep.estimateGas.handleOps([[op], wallet.address], { account: wallet })
                gasLimit = ((calcPreVerificationGas(op) + 3n * op.verificationGasLimit + op.callGasLimit) * 12n) / 10n
            }

            const gasPriceParameters = await getGasPrice(this.walletClient.chain.id, this.publicClient, this.logger)
            childLogger.debug({ gasPriceParameters }, "got gas price")

            // const minGasPrice = (95n * gasPrice) / 100n

            // if (op.maxFeePerGas < minGasPrice) {
            //     childLogger.debug(
            //         { gasPrice, userOperationMaxFeePerGas: op.maxFeePerGas, minGasPrice },
            //         "user operation maxFeePerGas too low"
            //     )
            //     throw new RpcError(
            //         `user operation maxFeePerGas too low, got ${formatGwei(
            //             op.maxFeePerGas
            //         )} gwei expected at least ${formatGwei(minGasPrice)} gwei`
            //     )
            // }

            const nonce = await this.publicClient.getTransactionCount({
                address: wallet.address,
                blockTag: "pending"
            })
            childLogger.trace({ nonce }, "got nonce")

            let txHash: HexData32
            if (this.simulateTransaction) {
                const { request } = await ep.simulate.handleOps([[op], wallet.address], {
                    gas: gasLimit,
                    account: wallet,
                    chain: this.walletClient.chain,
                    maxFeePerGas: gasPriceParameters.maxFeePerGas,
                    maxPriorityFeePerGas: gasPriceParameters.maxPriorityFeePerGas,
                    nonce: nonce
                })

                // scroll alpha testnet doesn't support eip-1559 txs yet
                if (this.walletClient.chain?.id === 534353) {
                    request.gasPrice = request.maxFeePerGas
                    request.maxFeePerGas = undefined
                    request.maxPriorityFeePerGas = undefined
                }

                const { chain: _chain, abi: _abi, ...loggingRequest } = request
                childLogger.trace({ request: { ...loggingRequest } }, "got request")

                txHash = await this.walletClient.writeContract(request)

                this.monitoredTransactions[opHash] = {
                    transactionHash: txHash,
                    transactionRequest: request,
                    executor: wallet
                }
            } else {
                txHash = await ep.write.handleOps([[op], wallet.address], {
                    gas: gasLimit,
                    account: wallet,
                    chain: this.walletClient.chain,
                    maxFeePerGas: gasPriceParameters.maxFeePerGas,
                    maxPriorityFeePerGas: gasPriceParameters.maxPriorityFeePerGas,
                    nonce: nonce
                })

                this.monitoredTransactions[opHash] = {
                    transactionHash: txHash,
                    transactionRequest: {
                        address: ep.address,
                        abi: ep.abi,
                        functionName: "handleOps",
                        args: [[op], wallet.address],
                        gas: gasLimit,
                        account: wallet,
                        chain: this.walletClient.chain,
                        maxFeePerGas: gasPriceParameters.maxFeePerGas,
                        maxPriorityFeePerGas: gasPriceParameters.maxPriorityFeePerGas,
                        nonce: nonce
                    },
                    executor: wallet
                }
            }

            childLogger.info({ txHash, userOpHash: opHash }, "submitted bundle transaction")
            this.monitor.setUserOperationStatus(opHash, { status: "submitted", transactionHash: txHash })
            this.metrics.userOperationsBundlesSubmitted.inc()
        } catch (e: unknown) {
            await this.senderManager.pushWallet(wallet)

            if (e instanceof RpcError) {
                throw e
            } else if (e instanceof ContractFunctionRevertedError) {
                childLogger.warn({ error: e }, "user operation reverted (ContractFunctionRevertedError)")

                throw new RpcError(`user operation reverted: ${e.message}`)
            } else if (e instanceof ContractFunctionExecutionError) {
                const cause = e.cause

                const errorCauseParsing = errorCauseSchema.safeParse(cause)

                if (!errorCauseParsing.success) {
                    this.logger.error(
                        {
                            error: JSON.stringify(cause)
                        },
                        "error parsing error encountered during execution"
                    )
                    throw new Error(`error parsing error cause: ${fromZodError(errorCauseParsing.error)}`)
                }

                const errorCause = errorCauseParsing.data.data

                if (errorCause.errorName !== "FailedOp") {
                    throw new Error(`error cause is not FailedOp: ${JSON.stringify(errorCause)}`)
                }

                const reason = errorCause.args.reason

                childLogger.info({ error: reason }, "user operation reverted")

                throw new RpcError(`user operation reverted: ${reason}`)
            } else {
                childLogger.error({ error: e }, "unknown error bundling user operation")

                throw e
            }
        }
        this.startWatchingBlocks()
    }
}
