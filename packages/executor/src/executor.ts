import { EntryPointAbi, TransactionInfo, BundleResult } from "@alto/types"
import { Address, HexData32, UserOperation } from "@alto/types"
import { Logger, Metrics, getUserOperationHash } from "@alto/utils"
import { Mutex } from "async-mutex"
import {
    Account,
    Chain,
    FeeCapTooLowError,
    InsufficientFundsError,
    IntrinsicGasTooLowError,
    NonceTooLowError,
    PublicClient,
    Transport,
    WalletClient,
    getContract
} from "viem"
import { SenderManager } from "./senderManager"
import * as chains from "viem/chains"
import { getGasPrice } from "@alto/utils"
import { filterOpsAndEstimateGas, flushStuckTransaction, parseViemError, simulatedOpsToResults } from "./utils"

export interface GasEstimateResult {
    preverificationGas: bigint
    verificationGasLimit: bigint
    callGasLimit: bigint
}

export interface IExecutor {
    bundle(entryPoint: Address, ops: UserOperation[]): Promise<BundleResult[]>
    replaceTransaction(transactionInfo: TransactionInfo): Promise<TransactionInfo | undefined>
    cancelOps(entryPoint: Address, ops: UserOperation[]): Promise<void>
    markWalletProcessed(executor: Account): Promise<void>
    flushStuckTransactions(): Promise<void>
}

export class NullExecutor implements IExecutor {
    async bundle(entryPoint: Address, ops: UserOperation[]): Promise<BundleResult[]> {
        return []
    }
    async replaceTransaction(transactionInfo: TransactionInfo): Promise<TransactionInfo | undefined> {
        return
    }
    async replaceOps(opHahes: HexData32[]): Promise<void> {}
    async cancelOps(entryPoint: Address, ops: UserOperation[]): Promise<void> {}
    async markWalletProcessed(executor: Account): Promise<void> {}
    async flushStuckTransactions(): Promise<void> {}
}

export class BasicExecutor implements IExecutor {
    // private unWatch: WatchBlocksReturnType | undefined

    publicClient: PublicClient
    walletClient: WalletClient<Transport, Chain, Account | undefined>
    senderManager: SenderManager
    entryPoint: Address
    logger: Logger
    metrics: Metrics
    simulateTransaction: boolean

    mutex: Mutex

    constructor(
        publicClient: PublicClient,
        walletClient: WalletClient<Transport, Chain, Account | undefined>,
        senderManager: SenderManager,
        entryPoint: Address,
        logger: Logger,
        metrics: Metrics,
        simulateTransaction = false
    ) {
        this.publicClient = publicClient
        this.walletClient = walletClient
        this.senderManager = senderManager
        this.entryPoint = entryPoint
        this.logger = logger
        this.metrics = metrics
        this.simulateTransaction = simulateTransaction

        this.mutex = new Mutex()
    }

    cancelOps(_entryPoint: Address, _ops: UserOperation[]): Promise<void> {
        throw new Error("Method not implemented.")
    }

    async markWalletProcessed(executor: Account) {
        if (!this.senderManager.availableWallets.includes(executor)) {
            await this.senderManager.pushWallet(executor)
        }
    }

    async replaceTransaction(transactionInfo: TransactionInfo) {
        const newRequest = { ...transactionInfo.transactionRequest }

        const gasPriceParameters = await getGasPrice(this.walletClient.chain.id, this.publicClient, this.logger)

        newRequest.maxFeePerGas =
            gasPriceParameters.maxFeePerGas > (newRequest.maxFeePerGas * 11n) / 10n
                ? gasPriceParameters.maxFeePerGas
                : (newRequest.maxFeePerGas * 11n) / 10n

        newRequest.maxPriorityFeePerGas = (newRequest.maxPriorityFeePerGas * 11n) / 10n
        newRequest.account = transactionInfo.executor

        const ep = getContract({
            abi: EntryPointAbi,
            address: this.entryPoint,
            publicClient: this.publicClient,
            walletClient: this.walletClient
        })

        const result = await filterOpsAndEstimateGas(
            ep,
            transactionInfo.executor,
            transactionInfo.userOperationInfos,
            newRequest.nonce,
            newRequest.maxFeePerGas,
            newRequest.maxPriorityFeePerGas,
            "latest",
            this.logger
        )

        const childLogger = this.logger.child({
            transactionHash: transactionInfo.transactionHash,
            executor: transactionInfo.executor.address
        })

        if (result.simulatedOps.length === 0) {
            childLogger.warn("no ops to bundle")
            this.markWalletProcessed(transactionInfo.executor)
            return
        }

        if (result.simulatedOps.every((op) => op.reason !== undefined)) {
            childLogger.warn("all ops failed simulation")
            this.markWalletProcessed(transactionInfo.executor)
            return
        }

        const opsToBundle = result.simulatedOps
            .filter((op) => op.reason === undefined)
            .map((op) => {
                const opInfo = transactionInfo.userOperationInfos.find(
                    (info) => info.userOperationHash === op.op.userOperationHash
                )
                if (!opInfo) {
                    throw new Error("opInfo not found")
                }
                return opInfo
            })

        newRequest.gas = result.gasLimit
        newRequest.args = [opsToBundle.map((owh) => owh.userOperation), transactionInfo.executor.address]

        try {
            childLogger.info(
                {
                    newRequest,
                    opsToBundle: opsToBundle.map((op) => op.userOperationHash)
                },
                "replacing transaction"
            )

            const txHash = await this.walletClient.writeContract(newRequest)

            const newTxInfo = {
                ...transactionInfo,
                transactionRequest: newRequest,
                transactionHash: txHash,
                lastReplaced: Date.now(),
                userOperationInfos: opsToBundle.map((op) => {
                    return {
                        userOperation: op.userOperation,
                        userOperationHash: op.userOperationHash,
                        lastReplaced: Date.now(),
                        firstSubmitted: op.firstSubmitted
                    }
                })
            }

            return newTxInfo
        } catch (err: unknown) {
            const e = parseViemError(err)
            if (!e) {
                childLogger.error({ error: err }, "unknown error replacing transaction")
            }

            if (e instanceof NonceTooLowError) {
                childLogger.warn({ error: e }, "nonce too low, not replacing")
            }

            if (e instanceof FeeCapTooLowError) {
                childLogger.warn({ error: e }, "fee cap too low, not replacing")
            }

            if (e instanceof InsufficientFundsError) {
                childLogger.warn({ error: e }, "insufficient funds, not replacing")
            }

            if (e instanceof IntrinsicGasTooLowError) {
                childLogger.warn({ error: e }, "intrinsic gas too low, not replacing")
            }

            childLogger.warn({ error: e }, "error replacing transaction")
            this.markWalletProcessed(transactionInfo.executor)
            return
        }
    }

    async flushStuckTransactions(): Promise<void> {
        const gasPrice = 10n * (await this.publicClient.getGasPrice())

        const wallets = [...this.senderManager.wallets, this.senderManager.utilityAccount]
        const promises = wallets.map(async (wallet) => {
            return flushStuckTransaction(this.publicClient, this.walletClient, wallet, gasPrice, this.logger)
        })

        await Promise.all(promises)
    }

    async bundle(entryPoint: Address, ops: UserOperation[]): Promise<BundleResult[]> {
        const opsWithHashes = ops.map((op) => {
            return {
                userOperation: op,
                userOperationHash: getUserOperationHash(op, entryPoint, this.walletClient.chain.id)
            }
        })

        const wallet = await this.senderManager.getWallet()

        const ep = getContract({
            abi: EntryPointAbi,
            address: entryPoint,
            publicClient: this.publicClient,
            walletClient: this.walletClient
        })

        let childLogger = this.logger.child({
            userOperations: opsWithHashes.map((oh) => oh.userOperation),
            entryPoint
        })
        childLogger.debug("bundling user operation")

        const gasPriceParameters = await getGasPrice(this.walletClient.chain.id, this.publicClient, this.logger)
        childLogger.debug({ gasPriceParameters }, "got gas price")

        const nonce = await this.publicClient.getTransactionCount({
            address: wallet.address,
            blockTag: "pending"
        })
        childLogger.trace({ nonce }, "got nonce")

        // scroll alpha testnet doesn't support eip-1559 txs yet
        const onlyPre1559 = this.walletClient.chain.id === chains.scrollTestnet.id

        const { gasLimit, simulatedOps } = await filterOpsAndEstimateGas(
            ep,
            wallet,
            opsWithHashes,
            nonce,
            gasPriceParameters.maxFeePerGas,
            gasPriceParameters.maxPriorityFeePerGas,
            "pending",
            childLogger
        )

        if (simulatedOps.length === 0) {
            childLogger.error("gas limit simulation encountered unexpected failure")
            this.markWalletProcessed(wallet)
            return opsWithHashes.map((owh) => {
                return {
                    success: false,
                    error: {
                        userOpHash: owh.userOperationHash,
                        reason: "INTERNAL FAILURE"
                    }
                }
            })
        }

        if (simulatedOps.every((op) => op.reason !== undefined)) {
            childLogger.warn("all ops failed simulation")
            this.markWalletProcessed(wallet)
            return simulatedOps.map((op) => {
                return {
                    success: false,
                    error: {
                        userOpHash: op.op.userOperationHash,
                        reason: op.reason as string
                    }
                }
            })
        }

        const opsToBundle = simulatedOps.filter((op) => op.reason === undefined).map((op) => op.op)

        childLogger = this.logger.child({
            userOperations: opsToBundle.map((oh) => oh.userOperation),
            entryPoint
        })

        childLogger.trace({ gasLimit, opsToBundle: opsToBundle.map((sop) => sop.userOperationHash) }, "got gas limit")

        const txHash = await ep.write.handleOps(
            [opsToBundle.map((op) => op.userOperation), wallet.address],
            onlyPre1559
                ? {
                      account: wallet,
                      gas: gasLimit,
                      gasPrice: gasPriceParameters.maxFeePerGas,
                      nonce: nonce
                  }
                : {
                      account: wallet,
                      gas: gasLimit,
                      maxFeePerGas: gasPriceParameters.maxFeePerGas,
                      maxPriorityFeePerGas: gasPriceParameters.maxPriorityFeePerGas,
                      nonce: nonce
                  }
        )

        const userOperationInfos = opsToBundle.map((op) => {
            this.metrics.userOperationsSubmitted.inc()

            return {
                userOperation: op.userOperation,
                userOperationHash: op.userOperationHash,
                lastReplaced: Date.now(),
                firstSubmitted: Date.now()
            }
        })

        const transactionInfo: TransactionInfo = {
            transactionHash: txHash,
            transactionRequest: {
                address: ep.address,
                abi: ep.abi,
                functionName: "handleOps",
                args: [opsToBundle.map((owh) => owh.userOperation), wallet.address],
                gas: gasLimit,
                account: wallet,
                chain: this.walletClient.chain,
                maxFeePerGas: gasPriceParameters.maxFeePerGas,
                maxPriorityFeePerGas: gasPriceParameters.maxPriorityFeePerGas,
                nonce: nonce
            },
            executor: wallet,
            userOperationInfos,
            lastReplaced: Date.now(),
            firstSubmitted: Date.now()
        }

        const userOperationResults: BundleResult[] = simulatedOpsToResults(simulatedOps, transactionInfo)

        childLogger.info(
            { txHash, opHashes: opsToBundle.map((owh) => owh.userOperationHash) },
            "submitted bundle transaction"
        )

        this.metrics.bundlesSubmitted.inc()

        return userOperationResults
    }
}
