import {
    EntryPointAbi,
    SubmissionStatus,
    TransactionInfo,
    UserOperationMempoolEntry,
    UserOperationWithHash,
    failedOpErrorSchema
} from "@alto/types"
import { Address, HexData32, UserOperation } from "@alto/types"
import { Logger, Metrics, getUserOperationHash, transactionIncluded } from "@alto/utils"
import { Mutex } from "async-mutex"
import {
    Account,
    Chain,
    ContractFunctionExecutionError,
    ContractFunctionRevertedError,
    FeeCapTooLowError,
    GetContractReturnType,
    InsufficientFundsError,
    IntrinsicGasTooLowError,
    NonceTooLowError,
    PublicClient,
    Transport,
    WalletClient,
    getContract
} from "viem"
import { SenderManager } from "./senderManager"
import { getGasPrice } from "./gasPrice"
import * as chains from "viem/chains"

// enum Action {
//     Resubmit = "resubmit",
//     Drop = "drop",
//     NoAction = "noAction"
// }

function parseViemError(err: unknown) {
    if (err instanceof ContractFunctionExecutionError) {
        const e = err.walk()
        if (e instanceof NonceTooLowError) {
            return e
        } else if (e instanceof FeeCapTooLowError) {
            return e
        } else if (e instanceof InsufficientFundsError) {
            return e
        } else if (e instanceof IntrinsicGasTooLowError) {
            return e
        } else if (e instanceof ContractFunctionRevertedError) {
            return e
        }
        return
    } else {
        return
    }
}

export interface GasEstimateResult {
    preverificationGas: bigint
    verificationGasLimit: bigint
    callGasLimit: bigint
}

export interface IExecutor {
    bundle(entryPoint: Address, ops: UserOperation[]): Promise<UserOperationMempoolEntry[]>
    replaceTransaction(transactionInfo: TransactionInfo): Promise<TransactionInfo | undefined>
    cancelOps(entryPoint: Address, ops: UserOperation[]): Promise<void>
    markProcessed(transactionInfo: TransactionInfo): Promise<void>
    flushStuckTransactions(): Promise<void>
}

export class NullExecutor implements IExecutor {
    async bundle(entryPoint: Address, ops: UserOperation[]): Promise<UserOperationMempoolEntry[]> {
        return []
    }
    async replaceTransaction(transactionInfo: TransactionInfo): Promise<TransactionInfo | undefined> {
        return
    }
    async replaceOps(opHahes: HexData32[]): Promise<void> {}
    async cancelOps(entryPoint: Address, ops: UserOperation[]): Promise<void> {}
    async markProcessed(transactionInfo: TransactionInfo): Promise<void> {}
    async flushStuckTransactions(): Promise<void> {}
}

async function filterOpsAndEstimateGas(
    ep: GetContractReturnType<typeof EntryPointAbi, PublicClient, WalletClient>,
    wallet: Account,
    ops: UserOperationWithHash[],
    nonce: number,
    maxFeePerGas: bigint,
    maxPriorityFeePerGas: bigint,
    logger: Logger
) {
    const simulatedOps: {
        op: UserOperationWithHash
        reason: string | undefined
    }[] = ops.map((op) => {
        return { op, reason: undefined }
    })

    let gasLimit: bigint

    while (simulatedOps.length > 0) {
        try {
            gasLimit = await ep.estimateGas.handleOps(
                [simulatedOps.filter((op) => op.reason === undefined).map((op) => op.op.userOperation), wallet.address],
                {
                    account: wallet,
                    maxFeePerGas: maxFeePerGas,
                    maxPriorityFeePerGas: maxPriorityFeePerGas,
                    nonce: nonce,
                    blockTag: "latest"
                }
            )

            return { simulatedOps, gasLimit }
        } catch (err: unknown) {
            const e = parseViemError(err)
            if (e instanceof ContractFunctionRevertedError) {
                const parsingResult = failedOpErrorSchema.safeParse(e.data)
                if (parsingResult.success) {
                    const failedOpError = parsingResult.data
                    logger.warn({ failedOpError }, "user op in batch invalid")
                    simulatedOps[Number(failedOpError.args.opIndex)].reason = failedOpError.args.reason
                } else {
                    logger.error({ error: parsingResult.error }, "failed to parse failedOpError")
                    return { simulatedOps: [], gasLimit: 0n }
                }
            } else {
                logger.error({ error: err }, "error estimating gas")
                return { simulatedOps: [], gasLimit: 0n }
            }
        }
    }
    return { simulatedOps, gasLimit: 0n }
}

export class BasicExecutor implements IExecutor {
    // private unWatch: WatchBlocksReturnType | undefined

    beneficiary: Address
    publicClient: PublicClient
    walletClient: WalletClient<Transport, Chain, Account | undefined>
    senderManager: SenderManager
    entryPoint: Address
    logger: Logger
    metrics: Metrics
    simulateTransaction: boolean

    mutex: Mutex

    constructor(
        beneficiary: Address,
        publicClient: PublicClient,
        walletClient: WalletClient<Transport, Chain, Account | undefined>,
        senderManager: SenderManager,
        entryPoint: Address,
        logger: Logger,
        metrics: Metrics,
        simulateTransaction = false
    ) {
        this.beneficiary = beneficiary
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

    async markProcessed(transactionInfo: TransactionInfo) {
        await this.senderManager.pushWallet(transactionInfo.executor)
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
            this.logger
        )

        if (result.simulatedOps.length === 0) {
            this.logger.warn("no ops to bundle")
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
            this.logger.info(
                {
                    transactionHash: transactionInfo.transactionHash,
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
                this.logger.error({ error: err }, "unknown error replacing transaction")
            }

            if (e instanceof NonceTooLowError) {
                this.logger.warn({ error: e }, "nonce too low, not replacing")
            }

            if (e instanceof FeeCapTooLowError) {
                this.logger.warn({ error: e }, "fee cap too low, not replacing")
            }

            if (e instanceof InsufficientFundsError) {
                this.logger.warn({ error: e }, "insufficient funds, not replacing")
            }

            if (e instanceof IntrinsicGasTooLowError) {
                this.logger.warn({ error: e }, "intrinsic gas too low, not replacing")
            }

            this.logger.warn({ error: e }, "error replacing transaction")

            return
        }
    }

    // async replaceOps(opHahes: HexData32[]) {
    //     const txStatusesToReplace = Array.from(
    //         new Set(opHahes.map((hash) => this.findTxForOp(hash)).filter((tx) => tx !== undefined) as TransactionInfo[])
    //     )

    //     txStatusesToReplace.map((txStatus) => {
    //         this.replaceTransaction(txStatus)
    //     })
    // }

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

    async bundle(entryPoint: Address, ops: UserOperation[]): Promise<UserOperationMempoolEntry[]> {
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

        const childLogger = this.logger.child({
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
            childLogger
        )

        if (simulatedOps.length === 0) {
            childLogger.warn("no ops to bundle")
            this.senderManager.pushWallet(wallet)
            return opsWithHashes.map((owh) => {
                return {
                    status: SubmissionStatus.Rejected,
                    userOperationInfo: {
                        userOperation: owh.userOperation,
                        userOperationHash: owh.userOperationHash,
                        lastReplaced: Date.now(),
                        firstSubmitted: Date.now()
                    },
                    reason: "INTERNAL FAILURE"
                }
            })
        }

        childLogger.trace(
            { gasLimit, simulatedOps: simulatedOps.map((sop) => sop.op.userOperationHash) },
            "got gas limit"
        )

        const opsToBundle = simulatedOps.filter((op) => op.reason === undefined).map((op) => op.op)

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

        const userOperationResults = simulatedOps.map((sop) => {
            if (sop.reason === undefined) {
                return {
                    status: SubmissionStatus.Submitted as const,
                    userOperationInfo: {
                        userOperation: sop.op.userOperation,
                        userOperationHash: sop.op.userOperationHash,
                        lastReplaced: Date.now(),
                        firstSubmitted: Date.now()
                    },
                    transactionInfo
                }
            } else {
                return {
                    status: SubmissionStatus.Rejected as const,
                    userOperationInfo: {
                        userOperation: sop.op.userOperation,
                        userOperationHash: sop.op.userOperationHash,
                        lastReplaced: Date.now(),
                        firstSubmitted: Date.now()
                    },
                    reason: sop.reason as string
                }
            }
        })

        childLogger.info(
            { txHash, opHashes: opsWithHashes.map((owh) => owh.userOperationHash) },
            "submitted bundle transaction"
        )

        this.metrics.userOperationsBundlesSubmitted.inc()

        return userOperationResults
    }
}
