import { EntryPointAbi, RpcError } from "@alto/types"
import { Address, HexData32, UserOperation } from "@alto/types"
import { Logger } from "@alto/utils"
import { Mutex } from "async-mutex"
import { Account, Block, PublicClient, WalletClient, WatchBlocksReturnType, getContract, formatGwei } from "viem"
import { SenderManager } from "./senderManager"

export interface GasEstimateResult {
    preverificationGas: bigint
    verificationGasLimit: bigint
    callGasLimit: bigint
}

export interface IExecutor {
    bundle(_entryPoint: Address, _op: UserOperation): Promise<void>
}

export class NullExecutor implements IExecutor {
    async bundle(_entryPoint: Address, _op: UserOperation): Promise<void> {
        // return 32 byte long hex string
    }
}

type UserOperationStatus = {
    transactionHash: HexData32
    transactionRequest: any
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
    walletClient: WalletClient
    senderManager: SenderManager
    entryPoint: Address
    pollingInterval: number
    logger: Logger

    mutex: Mutex
    constructor(
        beneficiary: Address,
        publicClient: PublicClient,
        walletClient: WalletClient,
        senderManager: SenderManager,
        entryPoint: Address,
        pollingInterval: number,
        logger: Logger
    ) {
        this.beneficiary = beneficiary
        this.publicClient = publicClient
        this.walletClient = walletClient
        this.senderManager = senderManager
        this.entryPoint = entryPoint
        this.pollingInterval = pollingInterval
        this.logger = logger

        this.mutex = new Mutex()
    }

    startWatchingBlocks(): void {
        if (this.unWatch) {
            return
        }
        this.unWatch = this.publicClient.watchBlocks({
            onBlock: (block) => {
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
            emitMissed: true,
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

        opHashes.map(async (opHash) => {
            const opStatus = this.monitoredTransactions[opHash]
            const txIncluded = await transactionIncluded(opStatus.transactionHash, this.publicClient)
            const childLogger = this.logger.child({
                userOpHash: opHash,
                txHash: opStatus.transactionHash,
                executor: opStatus.executor.address
            })
            if (txIncluded) {
                childLogger.info("transaction successfully included")
                delete this.monitoredTransactions[opHash]
                this.senderManager.pushWallet(opStatus.executor)
                return
            }

            childLogger.debug("transaction not included")

            const transaction = opStatus.transactionRequest
            childLogger.debug(
                { baseFeePerGas: block.baseFeePerGas, maxFeePerGas: transaction.maxFeePerGas },
                "queried gas fee parameters"
            )
            if (
                block.baseFeePerGas === null ||
                transaction.maxFeePerGas === undefined ||
                transaction.maxPriorityFeePerGas === undefined ||
                block.baseFeePerGas <= transaction.maxFeePerGas
            ) {
                childLogger.debug(
                    { baseFeePerGas: block.baseFeePerGas, maxFeePerGas: transaction.maxFeePerGas },
                    "gas price is high enough, not replacing transaction"
                )
                return
            }

            childLogger.debug("replacing transaction")
            const gasPrice = await this.publicClient.getGasPrice()
            delete this.monitoredTransactions[opHash]

            const request = {
                ...transaction,
                maxFeePerGas:
                    gasPrice > (transaction.maxFeePerGas * 11n) / 10n
                        ? gasPrice
                        : (transaction.maxFeePerGas * 11n) / 10n,
                maxPriorityFeePerGas: (transaction.maxPriorityFeePerGas * 11n) / 10n
            }

            const { chain: _chain, abi: _abi, ...loggingRequest } = request
            childLogger.debug({ request: { ...loggingRequest } }, "generated replacement transaction request")

            try {
                const tx = await this.walletClient.writeContract(request)
                this.monitoredTransactions[opHash] = {
                    transactionHash: tx,
                    transactionRequest: request,
                    executor: opStatus.executor
                }

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

        await this.mutex.runExclusive(async () => {
            const childLogger = this.logger.child({ userOperation: op, entryPoint })
            childLogger.debug("bundling user operation")
            const ep = getContract({
                abi: EntryPointAbi,
                address: entryPoint,
                publicClient: this.publicClient,
                walletClient: this.walletClient
            })

            try {
                const opHash = await ep.read.getUserOpHash([op])
                childLogger.debug({ opHash }, "got op hash")

                if (opHash in this.monitoredTransactions) {
                    childLogger.debug({ opHash }, "user operation already bundled")
                    throw new RpcError(`user operation ${opHash} already bundled`)
                }

                let gasLimit: bigint
                try {
                    gasLimit = await ep.estimateGas
                        .handleOps([[op], wallet.address], { account: wallet })
                        .then((limit) => {
                            return (limit * 12n) / 10n
                        })
                } catch (_e) {
                    this.logger.warn({ userOperation: op, entryPoint }, "user operation reverted during gas estimation")
                    return
                }

                const gasPrice = await this.publicClient.getGasPrice()
                childLogger.debug({ gasPrice }, "got gas price")

                if (op.maxFeePerGas < gasPrice) {
                    childLogger.debug(
                        { gasPrice, userOperationMaxFeePerGas: op.maxFeePerGas },
                        "user operation maxFeePerGas too low"
                    )
                    throw new RpcError(
                        `user operation maxFeePerGas too low, got ${formatGwei(
                            op.maxFeePerGas
                        )} gwei expected at least ${formatGwei(gasPrice)} gwei`
                    )
                }

                const nonce = await this.publicClient.getTransactionCount({
                    address: wallet.address,
                    blockTag: "pending"
                })
                childLogger.debug({ nonce }, "got nonce")

                const maxPriorityFeePerGas = 1_000_000_000n > gasPrice ? gasPrice : 1_000_000_000n

                const { request } = await ep.simulate.handleOps([[op], wallet.address], {
                    gas: gasLimit,
                    account: wallet,
                    chain: this.walletClient.chain,
                    maxFeePerGas: gasPrice,
                    maxPriorityFeePerGas,
                    nonce: nonce
                })

                const { chain: _chain, abi: _abi, ...loggingRequest } = request
                childLogger.debug({ request: { ...loggingRequest } }, "got request")

                const txHash = await this.walletClient.writeContract(request)
                childLogger.info({ txHash, userOpHash: opHash }, "submitted bundle transaction")

                this.monitoredTransactions[opHash] = {
                    transactionHash: txHash,
                    transactionRequest: request,
                    executor: wallet
                }
            } catch (e) {
                childLogger.error({ error: e }, "error bundling user operation")
                await this.senderManager.pushWallet(wallet)
                throw e
            }

            this.startWatchingBlocks()
        })
    }
}
