import { Address, BundlingMode, EntryPointAbi, errorCauseSchema, HexData32, RpcError, UserOperation, ValidationErrors } from "@alto/types"
import { Logger } from "@alto/utils"
import { Mutex } from "async-mutex"
import {
    Abi,
    Account,
    Block,
    Chain,
    ContractFunctionExecutionError,
    ContractFunctionRevertedError, getContract, PublicClient,
    Transport,
    WalletClient,
    WatchBlocksReturnType,
    WriteContractParameters, zeroAddress
} from "viem"
import { fromZodError } from "zod-validation-error"
import { getGasPrice } from "./gasPrice"
import { Monitor } from "./monitoring"
import { SenderManager } from "./senderManager"

export interface GasEstimateResult {
    preverificationGas: bigint
    verificationGasLimit: bigint
    callGasLimit: bigint
}

export interface IExecutor {
    bundle(_entryPoint: Address, _op: UserOperation): Promise<void>,
    setBundlingMode(bundlingMode: BundlingMode): void,
    dumpMempool(): Promise<UserOperation[]>,
    clearState(): void,
}

export class NullExecutor implements IExecutor {
    async bundle(_entryPoint: Address, _op: UserOperation): Promise<void> {
        // return 32 byte long hex string
    }
    
    setBundlingMode(_bundlingMode: "manual" | "auto"): void {}
    
    async dumpMempool(): Promise<UserOperation[]> {
        return []
    }

    clearState(): void {}
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
    simulateTransaction: boolean

    autoBundle: boolean
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
        simulateTransaction = false,
    ) {
        this.beneficiary = beneficiary
        this.publicClient = publicClient
        this.walletClient = walletClient
        this.senderManager = senderManager
        this.monitor = monitor
        this.entryPoint = entryPoint
        this.pollingInterval = pollingInterval
        this.logger = logger
        this.simulateTransaction = simulateTransaction

        this.autoBundle = true;
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
                this.monitor.setUserOperationStatus(opHash, {
                    status: "included",
                    transactionHash: opStatus.transactionHash
                })
                this.senderManager.pushWallet(opStatus.executor)
                return
            }

            childLogger.debug("transaction not included")

            const transaction = opStatus.transactionRequest
            childLogger.trace(
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

            let request
            if (this.walletClient.chain?.id !== 534353) {
                request = {
                    ...transaction,
                    maxFeePerGas:
                        gasPrice > (transaction.maxFeePerGas * 11n) / 10n
                            ? gasPrice
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
                        gasPrice > (transaction.gasPrice * 11n) / 10n ? gasPrice : (transaction.gasPrice * 11n) / 10n
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

    async dumpMempool(): Promise<UserOperation[]> {
        return Object.entries(this.monitoredTransactions)
            .map(([_, { transactionRequest }]) => (transactionRequest?.args?.[0] as UserOperation[])[0]);
    }

    async bundle(entryPoint: Address, op: UserOperation): Promise<void> {
        const wallet = await this.senderManager.getWallet()

        console.log("wallet: ", wallet);

        const ep = getContract({
            abi: EntryPointAbi,
            address: entryPoint,
            publicClient: this.publicClient,
            walletClient: this.walletClient
        })

        await this.mutex.runExclusive(async () => {
            const childLogger = this.logger.child({ userOperation: op, entryPoint })
            childLogger.debug("bundling user operation")

            try {
                const opHash = await ep.read.getUserOpHash([op])
                childLogger.debug({ opHash }, "got op hash");

                // look in monitoredTransactions and see if there are any other ops from the same sender and same nonce

                const oldOp = Object.entries(this.monitoredTransactions)
                    .map(([_opHash, { transactionRequest }]) => [_opHash, (transactionRequest?.args?.[0] as UserOperation[])[0]] as [string, UserOperation])
                    .find(([_opHash, _op]) => _op.sender === op.sender && _op.nonce === op.nonce);

                if (oldOp !== undefined) {
                    const [_opHash, _op] = oldOp;
                    const higherPriorityFee = _op.maxPriorityFeePerGas > op.maxPriorityFeePerGas;
                    const higherMaxFeePerGas = _op.maxFeePerGas > op.maxFeePerGas;

                    if (higherMaxFeePerGas && higherPriorityFee) {
                        // TODO: replace
                    }

                    childLogger.debug({ opHash }, "user operation already being bundled")
                    // throw new RpcError(`user operation ${opHash} already being bundled`)
                    throw new RpcError("...", ValidationErrors.InvalidFields);
                }

                // if (opHash in this.monitoredTransactions) {
                //     const higherPriorityFee = this.monitoredTransactions?.[opHash]?.transactionRequest?.maxPriorityFeePerGas ?? 0n > op.maxPriorityFeePerGas;
                //     const higherMaxFeePerGas = this.monitoredTransactions?.[opHash]?.transactionRequest?.maxFeePerGas ?? 0n > op.maxFeePerGas;

                //     if (higherPriorityFee && higherMaxFeePerGas) {
                        
                //         // TODO: bump priority fee
                //         // TODO: bump max fee
                //         // TODO: with less fee
                //         // TODO: fee_bump_below_threshold
                //         // TODO: fee_bump_above_threshold
                //         // TODO: max_allowed_ops
                //     }

                //     childLogger.debug({ opHash }, "user operation already being bundled")
                //     throw new RpcError(`user operation ${opHash} already being bundled`)
                // }

                const gasLimit =
                    (((op.preVerificationGas + 3n * op.verificationGasLimit + op.callGasLimit) * 12n) / 10n) *
                    (this.walletClient.chain?.id === 42161 ? 4n : 1n)

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

                    childLogger.trace({ autoBundle: this.autoBundle }, "not simulating transaction")
                    if (this.autoBundle) {
                       txHash = await this.walletClient.writeContract(request)
                    } else {
                        txHash = zeroAddress;
                        await this.senderManager.pushWallet(wallet);
                    }                    

                    this.monitoredTransactions[opHash] = {
                        transactionHash: txHash,
                        transactionRequest: request,
                        executor: wallet
                    }
                } else {
                    if (this.autoBundle) {
                        txHash = await ep.write.handleOps([[op], wallet.address], {
                            gas: gasLimit,
                            account: wallet,
                            chain: this.walletClient.chain,
                            maxFeePerGas: gasPriceParameters.maxFeePerGas,
                            maxPriorityFeePerGas: gasPriceParameters.maxPriorityFeePerGas,
                            nonce: nonce
                        })
                    } else {
                        txHash = zeroAddress;
                        await this.senderManager.pushWallet(wallet);
                    }

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

                    const epNonce = await ep.read.getNonce([op.sender, 0n])
                    console.log("epNonce", epNonce)    

                    throw e
                }
            }
            if (this.autoBundle) {
                this.startWatchingBlocks()
            }
        })
    }

    setBundlingMode(bundlingMode: "manual" | "auto"): void {
        this.autoBundle = (bundlingMode === "auto");
        if (!this.autoBundle) {
            this.stopWatchingBlocks();
        }
    }

    clearState(): void {
        this.monitoredTransactions = {};
        this.stopWatchingBlocks();
    }
}
