import { EntryPointAbi } from "@alto/types"
import { Address, HexData32, UserOperation } from "@alto/types"
import { Logger } from "@alto/utils"
import { Mutex } from "async-mutex"
import { Account, Block, PublicClient, WalletClient, WatchBlocksReturnType, getContract } from "viem"

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
    unWatch: WatchBlocksReturnType | undefined

    beneficiary: Address
    publicClient: PublicClient
    walletClient: WalletClient
    executeEOA: Account
    entryPoint: Address
    pollingInterval: number
    logger: Logger

    mutex: Mutex
    constructor(
        beneficiary: Address,
        publicClient: PublicClient,
        walletClient: WalletClient,
        executeEOA: Account,
        entryPoint: Address,
        pollingInterval: number,
        logger: Logger
    ) {
        this.beneficiary = beneficiary
        this.publicClient = publicClient
        this.walletClient = walletClient
        this.executeEOA = executeEOA
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
                        this.logger.trace("handled block")
                        // Handle the resolution of the promise here, if needed
                    })
                    .catch((error) => {
                        // Handle any errors that occur during the execution of the promise
                        this.logger.error(error, "error while handling block")
                    })
            },
            includeTransactions: false,
            pollingInterval: this.pollingInterval
        })

        this.logger.debug("started watching blocks")
    }

    stopWatchingBlocks(): void {
        if (this.unWatch) {
            this.logger.debug("stopped watching blocks")
            this.unWatch()
        }
    }

    async checkAndReplaceTransactions(block: Block): Promise<void> {
        // typescript mistakenly doesn't believe this is HexData32
        // @ts-ignore
        const opHashes: HexData32[] = Object.keys(this.monitoredTransactions)

        const transactionsReplaced = new Set()

        opHashes.map(async (opHash) => {
            const opStatus = this.monitoredTransactions[opHash]
            const txIncluded = await transactionIncluded(opStatus.transactionHash, this.publicClient)
            const childLogger = this.logger.child({ userOpHash: opHash, txHash: opStatus.transactionHash })
            if (txIncluded) {
                childLogger.debug("transaction included")
                delete this.monitoredTransactions[opHash]
                if (Object.keys(this.monitoredTransactions).length === 0) {
                    this.stopWatchingBlocks()
                }
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
                childLogger.debug("not replacing")
                return
            }

            if (transactionsReplaced.has(transaction)) {
                childLogger.debug("already replaced")
                return
            }

            childLogger.debug("replacing transaction")
            transactionsReplaced.add(transaction)
            // replace transaction
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
            childLogger.debug({ request: { ...loggingRequest } }, "replacing transaction")

            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            const tx = await this.walletClient.writeContract(request)

            this.monitoredTransactions[opHash] = {
                transactionHash: tx,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                transactionRequest: request
            }

            childLogger.info(
                {
                    txHash: tx,
                    oldTxHash: opStatus.transactionHash,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    maxFeePerGas: request.maxFeePerGas,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    oldMaxFeePerGas: transaction.maxFeePerGas,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    maxPriorityFeePerGas: request.maxPriorityFeePerGas,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    oldMaxPriorityFeePerGas: transaction.maxPriorityFeePerGas
                },
                "replaced transaction"
            )
        })
    }

    async bundle(entryPoint: Address, op: UserOperation): Promise<void> {
        await this.mutex.runExclusive(async () => {
            const childLogger = this.logger.child({ userOperation: op, entryPoint, module: "executor" })
            childLogger.debug("bundling user operation")
            const ep = getContract({
                abi: EntryPointAbi,
                address: entryPoint,
                publicClient: this.publicClient,
                walletClient: this.walletClient
            })

            let gasLimit: bigint
            try {
                gasLimit = await ep.estimateGas
                    .handleOps([[op], this.beneficiary], {
                        account: this.executeEOA
                    })
                    .then((limit) => {
                        return (limit * 12n) / 10n
                    })
            } catch (_e) {
                this.logger.warn({ userOperation: op, entryPoint }, "user operation reverted during gas estimation")
                return
            }

            const gasPrice = await this.publicClient.getGasPrice()
            childLogger.debug({ gasPrice }, "got gas price")

            const nonce = await this.publicClient.getTransactionCount({ address: this.executeEOA.address })
            childLogger.debug({ nonce }, "got nonce")

            const maxPriorityFeePerGas = 1_000_000_000n > gasPrice ? gasPrice : 1_000_000_000n

            const { request } = await ep.simulate.handleOps([[op], this.beneficiary], {
                gas: gasLimit,
                account: this.executeEOA,
                chain: this.walletClient.chain,
                maxFeePerGas: gasPrice,
                maxPriorityFeePerGas,
                nonce: nonce
            })

            const { chain: _chain, abi: _abi, ...loggingRequest } = request
            childLogger.debug({ request: { ...loggingRequest } }, "got request")

            const txHash = await this.walletClient.writeContract(request)
            childLogger.info({ txHash }, "sent transaction")

            const opHash = await ep.read.getUserOpHash([op])
            childLogger.debug({ opHash }, "got op hash")

            this.monitoredTransactions[opHash] = {
                transactionHash: txHash,
                transactionRequest: request
            }

            this.startWatchingBlocks()
        })
    }
}
