import type { SenderManager } from "@alto/executor"
import type { EventManager, GasPriceManager } from "@alto/handlers"
import type { InterfaceReputationManager, MemoryMempool } from "@alto/mempool"
import {
    type Address,
    type BundleResult,
    EntryPointV06Abi,
    EntryPointV07Abi,
    type HexData32,
    type PackedUserOperation,
    type TransactionInfo,
    type UserOperation,
    type UserOperationV07,
    type GasPriceParameters
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import {
    getUserOperationHash,
    isVersion06,
    maxBigInt,
    parseViemError,
    scaleBigIntByPercent,
    toPackedUserOperation
} from "@alto/utils"
import * as sentry from "@sentry/node"
import { Mutex } from "async-mutex"
import {
    FeeCapTooLowError,
    InsufficientFundsError,
    IntrinsicGasTooLowError,
    NonceTooLowError,
    TransactionExecutionError,
    encodeFunctionData,
    getContract,
    type Account,
    type Hex,
    BaseError,
    NonceTooHighError
} from "viem"
import {
    filterOpsAndEstimateGas,
    flushStuckTransaction,
    isTransactionUnderpricedError,
    getAuthorizationList
} from "./utils"
import type { SendTransactionErrorType } from "viem"
import type { AltoConfig } from "../createConfig"
import type { SendTransactionOptions } from "./types"
import { sendPflConditional } from "./fastlane"

export interface GasEstimateResult {
    preverificationGas: bigint
    verificationGasLimit: bigint
    callGasLimit: bigint
}

export type HandleOpsTxParam = {
    ops: PackedUserOperation[]
    isUserOpVersion06: boolean
    isReplacementTx: boolean
    entryPoint: Address
}

export type ReplaceTransactionResult =
    | {
          status: "replaced"
          transactionInfo: TransactionInfo
      }
    | {
          status: "potentially_already_included"
      }
    | {
          status: "failed"
      }

export class Executor {
    // private unWatch: WatchBlocksReturnType | undefined
    config: AltoConfig
    senderManager: SenderManager
    logger: Logger
    metrics: Metrics
    reputationManager: InterfaceReputationManager
    gasPriceManager: GasPriceManager
    mutex: Mutex
    mempool: MemoryMempool
    eventManager: EventManager

    constructor({
        config,
        mempool,
        senderManager,
        reputationManager,
        metrics,
        gasPriceManager,
        eventManager
    }: {
        config: AltoConfig
        mempool: MemoryMempool
        senderManager: SenderManager
        reputationManager: InterfaceReputationManager
        metrics: Metrics
        gasPriceManager: GasPriceManager
        eventManager: EventManager
    }) {
        this.config = config
        this.mempool = mempool
        this.senderManager = senderManager
        this.reputationManager = reputationManager
        this.logger = config.getLogger(
            { module: "executor" },
            {
                level: config.executorLogLevel || config.logLevel
            }
        )
        this.metrics = metrics
        this.gasPriceManager = gasPriceManager
        this.eventManager = eventManager

        this.mutex = new Mutex()
    }

    cancelOps(_entryPoint: Address, _ops: UserOperation[]): Promise<void> {
        throw new Error("Method not implemented.")
    }

    markWalletProcessed(executor: Account) {
        if (!this.senderManager.availableWallets.includes(executor)) {
            this.senderManager.pushWallet(executor)
        }
        return Promise.resolve()
    }

    async replaceTransaction(
        transactionInfo: TransactionInfo
    ): Promise<ReplaceTransactionResult> {
        const newRequest = { ...transactionInfo.transactionRequest }

        let gasPriceParameters: GasPriceParameters
        try {
            gasPriceParameters =
                await this.gasPriceManager.tryGetNetworkGasPrice()
        } catch (err) {
            this.logger.error({ error: err }, "Failed to get network gas price")
            return { status: "failed" }
        }

        newRequest.maxFeePerGas = scaleBigIntByPercent(
            gasPriceParameters.maxFeePerGas,
            115n
        )
        newRequest.maxPriorityFeePerGas = scaleBigIntByPercent(
            gasPriceParameters.maxPriorityFeePerGas,
            115n
        )
        newRequest.account = transactionInfo.executor

        const opsWithHashes = transactionInfo.userOperationInfos.map(
            (opInfo) => {
                const op = opInfo.userOperation
                return {
                    userOperation: opInfo.userOperation,
                    userOperationHash: getUserOperationHash(
                        op,
                        transactionInfo.entryPoint,
                        this.config.walletClient.chain.id
                    ),
                    entryPoint: opInfo.entryPoint
                }
            }
        )

        const [isUserOpV06, entryPoint] = opsWithHashes.reduce(
            (acc, owh) => {
                if (
                    acc[0] !== isVersion06(owh.userOperation) ||
                    acc[1] !== owh.entryPoint
                ) {
                    throw new Error(
                        "All user operations must be of the same version"
                    )
                }
                return acc
            },
            [
                isVersion06(opsWithHashes[0].userOperation),
                opsWithHashes[0].entryPoint
            ]
        )

        const ep = getContract({
            abi: isUserOpV06 ? EntryPointV06Abi : EntryPointV07Abi,
            address: entryPoint,
            client: {
                public: this.config.publicClient,
                wallet: this.config.walletClient
            }
        })

        const childLogger = this.logger.child({
            transactionHash: transactionInfo.transactionHash,
            executor: transactionInfo.executor.address
        })

        let bundleResult = await filterOpsAndEstimateGas({
            ep,
            isUserOpV06,
            wallet: newRequest.account,
            ops: opsWithHashes,
            nonce: newRequest.nonce,
            maxFeePerGas: newRequest.maxFeePerGas,
            maxPriorityFeePerGas: newRequest.maxPriorityFeePerGas,
            reputationManager: this.reputationManager,
            config: this.config,
            logger: childLogger
        })

        if (bundleResult.status === "unexpectedFailure") {
            return { status: "failed" }
        }

        let { opsToBundle, failedOps, gasLimit } = bundleResult

        const allOpsFailed = (opsToBundle.length = 0)
        const potentiallyIncluded = failedOps.every(
            (op) =>
                op.reason === "AA25 invalid account nonce" ||
                op.reason === "AA10 sender already constructed"
        )

        if (allOpsFailed && potentiallyIncluded) {
            childLogger.trace(
                { reasons: failedOps.map((sop) => sop.reason) },
                "all ops failed simulation with nonce error"
            )
            return { status: "potentially_already_included" }
        }

        if (allOpsFailed) {
            childLogger.warn("no ops to bundle")
            childLogger.warn("all ops failed simulation")
            return { status: "failed" }
        }

        // sometimes the estimation rounds down, adding a fixed constant accounts for this
        gasLimit += 10_000n

        // ensures that we don't submit again with too low of a gas value
        newRequest.gas = maxBigInt(newRequest.gas, gasLimit)

        // update calldata to include only ops that pass simulation
        let txParam: HandleOpsTxParam

        const userOps = opsToBundle.map((op) =>
            isUserOpV06
                ? op.userOperation
                : toPackedUserOperation(op.userOperation as UserOperationV07)
        ) as PackedUserOperation[]

        txParam = {
            isUserOpVersion06: isUserOpV06,
            isReplacementTx: true,
            ops: userOps,
            entryPoint: transactionInfo.entryPoint
        }

        try {
            childLogger.info(
                {
                    newRequest: {
                        ...newRequest,
                        abi: undefined,
                        chain: undefined
                    },
                    executor: newRequest.account.address,
                    ooooops: opsToBundle.map(
                        (opInfo) => opInfo.userOperationHash
                    )
                },
                "replacing transaction"
            )

            const txHash = await this.sendHandleOpsTransaction({
                txParam,
                opts: this.config.legacyTransactions
                    ? {
                          account: newRequest.account,
                          gasPrice: newRequest.maxFeePerGas,
                          gas: newRequest.gas,
                          nonce: newRequest.nonce
                      }
                    : {
                          account: newRequest.account,
                          maxFeePerGas: newRequest.maxFeePerGas,
                          maxPriorityFeePerGas: newRequest.maxPriorityFeePerGas,
                          gas: newRequest.gas,
                          nonce: newRequest.nonce
                      }
            })

            this.eventManager.emitSubmitted(
                opsToBundle.map((op) => op.userOperationHash),
                txHash
            )

            const newTxInfo: TransactionInfo = {
                ...transactionInfo,
                transactionRequest: newRequest,
                transactionHash: txHash,
                previousTransactionHashes: [
                    transactionInfo.transactionHash,
                    ...transactionInfo.previousTransactionHashes
                ],
                lastReplaced: Date.now(),
                userOperationInfos: opsToBundle.map((opInfo) => {
                    return {
                        entryPoint: opInfo.entryPoint,
                        userOperation: opInfo.userOperation,
                        userOperationHash: opInfo.userOperationHash,
                        lastReplaced: Date.now(),
                        firstSubmitted: opInfo.firstSubmitted
                    }
                })
            }

            return {
                status: "replaced",
                transactionInfo: newTxInfo
            }
        } catch (err: unknown) {
            const e = parseViemError(err)
            if (!e) {
                sentry.captureException(err)
                childLogger.error(
                    { error: err },
                    "unknown error replacing transaction"
                )
            }

            if (e instanceof NonceTooLowError) {
                childLogger.trace(
                    { error: e },
                    "nonce too low, potentially already included"
                )
                return { status: "potentially_already_included" }
            }

            if (e instanceof FeeCapTooLowError) {
                childLogger.warn({ error: e }, "fee cap too low, not replacing")
            }

            if (e instanceof InsufficientFundsError) {
                childLogger.warn(
                    { error: e },
                    "insufficient funds, not replacing"
                )
            }

            if (e instanceof IntrinsicGasTooLowError) {
                childLogger.warn(
                    { error: e },
                    "intrinsic gas too low, not replacing"
                )
            }

            childLogger.warn({ error: e }, "error replacing transaction")
            return { status: "failed" }
        }
    }

    async flushStuckTransactions(): Promise<void> {
        const allWallets = new Set(this.senderManager.wallets)

        const utilityWallet = this.senderManager.utilityAccount
        if (utilityWallet) {
            allWallets.add(utilityWallet)
        }

        const wallets = Array.from(allWallets)

        const gasPrice = await this.gasPriceManager.tryGetNetworkGasPrice()

        const promises = wallets.map((wallet) => {
            try {
                flushStuckTransaction(
                    this.config.publicClient,
                    this.config.walletClient,
                    wallet,
                    gasPrice.maxFeePerGas * 5n,
                    this.logger
                )
            } catch (e) {
                this.logger.error(
                    { error: e },
                    "error flushing stuck transaction"
                )
            }
        })

        await Promise.all(promises)
    }

    async sendHandleOpsTransaction({
        txParam,
        opts
    }: {
        txParam: HandleOpsTxParam
        opts:
            | {
                  gasPrice: bigint
                  maxFeePerGas?: undefined
                  maxPriorityFeePerGas?: undefined
                  account: Account
                  gas: bigint
                  nonce: number
              }
            | {
                  maxFeePerGas: bigint
                  maxPriorityFeePerGas: bigint
                  gasPrice?: undefined
                  account: Account
                  gas: bigint
                  nonce: number
              }
    }) {
        let data: Hex
        let to: Address

        const { isUserOpVersion06, ops, entryPoint } = txParam
        data = encodeFunctionData({
            abi: isUserOpVersion06 ? EntryPointV06Abi : EntryPointV07Abi,
            functionName: "handleOps",
            args: [ops, opts.account.address]
        })
        to = entryPoint

        const request =
            await this.config.walletClient.prepareTransactionRequest({
                to,
                data,
                ...opts
            })

        request.gas = scaleBigIntByPercent(
            request.gas,
            this.config.executorGasMultiplier
        )

        let isTransactionUnderPriced = false
        let attempts = 0
        let transactionHash: Hex | undefined
        const maxAttempts = 3

        // Try sending the transaction and updating relevant fields if there is an error.
        while (attempts < maxAttempts) {
            try {
                if (
                    this.config.enableFastlane &&
                    isUserOpVersion06 &&
                    !txParam.isReplacementTx &&
                    attempts === 0
                ) {
                    const serializedTransaction =
                        await this.config.walletClient.signTransaction(request)

                    transactionHash = await sendPflConditional({
                        serializedTransaction,
                        publicClient: this.config.publicClient,
                        walletClient: this.config.walletClient,
                        logger: this.logger
                    })

                    break
                }

                transactionHash =
                    await this.config.walletClient.sendTransaction(request)

                break
            } catch (e: unknown) {
                isTransactionUnderPriced = false

                if (e instanceof BaseError) {
                    if (isTransactionUnderpricedError(e)) {
                        this.logger.warn("Transaction underpriced, retrying")

                        request.maxFeePerGas = scaleBigIntByPercent(
                            request.maxFeePerGas,
                            150n
                        )
                        request.maxPriorityFeePerGas = scaleBigIntByPercent(
                            request.maxPriorityFeePerGas,
                            150n
                        )
                        isTransactionUnderPriced = true
                    }
                }

                const error = e as SendTransactionErrorType

                if (error instanceof TransactionExecutionError) {
                    const cause = error.cause

                    if (
                        cause instanceof NonceTooLowError ||
                        cause instanceof NonceTooHighError
                    ) {
                        this.logger.warn("Nonce too low, retrying")
                        request.nonce =
                            await this.config.publicClient.getTransactionCount({
                                address: request.from,
                                blockTag: "pending"
                            })
                    }

                    if (cause instanceof IntrinsicGasTooLowError) {
                        this.logger.warn("Intrinsic gas too low, retrying")
                        request.gas = scaleBigIntByPercent(request.gas, 150n)
                    }

                    // This is thrown by OP-Stack chains that use proxyd.
                    // ref: https://github.com/ethereum-optimism/optimism/issues/2618#issuecomment-1630272888
                    if (cause.details?.includes("no backends available")) {
                        this.logger.warn(
                            "no backends avaiable error, retrying after 500ms"
                        )
                        await new Promise((resolve) => setTimeout(resolve, 500))
                    }
                }

                if (attempts === maxAttempts) {
                    throw error
                }

                attempts++
            }
        }

        if (isTransactionUnderPriced) {
            await this.handleTransactionUnderPriced({
                nonce: request.nonce,
                executor: request.account
            })
        }

        // needed for TS
        if (!transactionHash) {
            throw new Error("Transaction hash not assigned")
        }

        return transactionHash as Hex
    }

    // Occurs when tx was sent with conflicting nonce, we want to resubmit all conflicting ops
    async handleTransactionUnderPriced({
        nonce,
        executor
    }: { nonce: number; executor: Account }) {
        const submitted = this.mempool.dumpSubmittedOps()

        const conflictingOps = submitted
            .filter((submitted) => {
                const tx = submitted.transactionInfo

                return (
                    tx.executor.address === executor.address &&
                    tx.transactionRequest.nonce === nonce
                )
            })
            .map(({ userOperation }) => userOperation)

        conflictingOps.map((op) => {
            this.logger.info(
                `Resubmitting ${op.userOperationHash} due to transaction underpriced`
            )
            this.mempool.removeSubmitted(op.userOperationHash)
            this.mempool.add(op.userOperation, op.entryPoint)
        })

        if (conflictingOps.length > 0) {
            this.markWalletProcessed(executor)
        }
    }

    async bundle(
        entryPoint: Address,
        ops: UserOperation[]
    ): Promise<BundleResult> {
        const wallet = await this.senderManager.getWallet()

        const opsWithHashes = ops.map((userOperation) => {
            return {
                userOperation,
                userOperationHash: getUserOperationHash(
                    userOperation,
                    entryPoint,
                    this.config.walletClient.chain.id
                )
            }
        })

        // Find bundle EntryPoint version.
        const firstOpVersion = isVersion06(ops[0])
        const allSameVersion = ops.every(
            (op) => isVersion06(op) === firstOpVersion
        )
        if (!allSameVersion) {
            throw new Error("All user operations must be of the same version")
        }
        const isUserOpV06 = firstOpVersion

        const ep = getContract({
            abi: isUserOpV06 ? EntryPointV06Abi : EntryPointV07Abi,
            address: entryPoint,
            client: {
                public: this.config.publicClient,
                wallet: this.config.walletClient
            }
        })

        let childLogger = this.logger.child({
            userOperations: opsWithHashes.map((oh) => oh.userOperationHash),
            entryPoint
        })
        childLogger.debug("bundling user operation")

        // These calls can throw, so we try/catch them to mark wallet as processed in event of error.
        let nonce: number
        let gasPriceParameters: GasPriceParameters
        try {
            ;[gasPriceParameters, nonce] = await Promise.all([
                this.gasPriceManager.tryGetNetworkGasPrice(),
                this.config.publicClient.getTransactionCount({
                    address: wallet.address,
                    blockTag: "pending"
                })
            ])
        } catch (err) {
            childLogger.error(
                { error: err },
                "Failed to get parameters for bundling"
            )
            this.markWalletProcessed(wallet)
            return {
                status: "resubmit",
                reason: "Failed to get parameters for bundling",
                userOperations: opsWithHashes.map((owh) => owh.userOperation)
            }
        }

        let estimateResult = await filterOpsAndEstimateGas({
            isUserOpV06,
            ep,
            wallet,
            ops: opsWithHashes,
            nonce,
            maxFeePerGas: gasPriceParameters.maxFeePerGas,
            maxPriorityFeePerGas: gasPriceParameters.maxPriorityFeePerGas,
            reputationManager: this.reputationManager,
            config: this.config,
            logger: childLogger
        })

        if (estimateResult.status === "unexpectedFailure") {
            childLogger.error(
                "gas limit simulation encountered unexpected failure"
            )
            this.markWalletProcessed(wallet)
            return {
                status: "failure",
                reason: "INTERNAL FAILURE",
                userOperations: ops
            }
        }

        let { gasLimit, opsToBundle, failedOps } = estimateResult

        if (opsToBundle.length === 0) {
            childLogger.warn("all ops failed simulation")
            this.markWalletProcessed(wallet)
            return {
                status: "failure",
                reason: "INTERNAL FAILURE",
                // TODO: we want to log the failure reason
                userOperations: ops
            }
        }

        childLogger = this.logger.child({
            userOperations: opsToBundle.map((owh) => owh.userOperationHash),
            entryPoint
        })

        // sometimes the estimation rounds down, adding a fixed constant accounts for this
        gasLimit += 10_000n

        let transactionHash: HexData32
        try {
            const isLegacyTransaction = this.config.legacyTransactions
            const authorizationList = getAuthorizationList(
                opsToBundle.map(({ userOperation }) => userOperation)
            )

            let opts: SendTransactionOptions
            if (isLegacyTransaction) {
                opts = {
                    type: "legacy",
                    gasPrice: gasPriceParameters.maxFeePerGas,
                    account: wallet,
                    gas: gasLimit,
                    nonce
                }
            } else if (authorizationList) {
                opts = {
                    type: "eip7702",
                    maxFeePerGas: gasPriceParameters.maxFeePerGas,
                    maxPriorityFeePerGas:
                        gasPriceParameters.maxPriorityFeePerGas,
                    account: wallet,
                    gas: gasLimit,
                    nonce,
                    authorizationList
                }
            } else {
                opts = {
                    type: "eip1559",
                    maxFeePerGas: gasPriceParameters.maxFeePerGas,
                    maxPriorityFeePerGas:
                        gasPriceParameters.maxPriorityFeePerGas,
                    account: wallet,
                    gas: gasLimit,
                    nonce
                }
            }

            const userOps = opsToBundle.map(({ userOperation }) => {
                if (isUserOpV06) {
                    return userOperation
                }

                return toPackedUserOperation(userOperation as UserOperationV07)
            }) as PackedUserOperation[]

            transactionHash = await this.sendHandleOpsTransaction({
                txParam: {
                    ops: userOps,
                    isReplacementTx: false,
                    isUserOpVersion06: isUserOpV06,
                    entryPoint
                },
                opts
            })

            opsToBundle.map(({ userOperationHash }) => {
                this.eventManager.emitSubmitted(
                    userOperationHash,
                    transactionHash
                )
            })
        } catch (err: unknown) {
            const e = parseViemError(err)
            if (e instanceof InsufficientFundsError) {
                childLogger.error(
                    { error: e },
                    "insufficient funds, not submitting transaction"
                )
                this.markWalletProcessed(wallet)
                return {
                    status: "resubmit",
                    reason: InsufficientFundsError.name,
                    userOperations: opsToBundle.map((owh) => owh.userOperation)
                }
            }

            sentry.captureException(err)
            childLogger.error(
                { error: JSON.stringify(err) },
                "error submitting bundle transaction"
            )
            this.markWalletProcessed(wallet)
            return {
                status: "failure",
                reason: "INTERNAL FAILURE",
                userOperations: opsWithHashes.map((owh) => owh.userOperation)
            }
        }

        const userOperationInfos = opsToBundle.map((op) => {
            return {
                entryPoint,
                userOperation: op.userOperation,
                userOperationHash: op.userOperationHash,
                lastReplaced: Date.now(),
                firstSubmitted: Date.now()
            }
        })

        const transactionInfo: TransactionInfo = {
            entryPoint,
            isVersion06: isUserOpV06,
            transactionHash: transactionHash,
            previousTransactionHashes: [],
            transactionRequest: {
                account: wallet,
                to: ep.address,
                gas: gasLimit,
                chain: this.config.walletClient.chain,
                maxFeePerGas: gasPriceParameters.maxFeePerGas,
                maxPriorityFeePerGas: gasPriceParameters.maxPriorityFeePerGas,
                nonce: nonce
            },
            executor: wallet,
            userOperationInfos,
            lastReplaced: Date.now(),
            firstSubmitted: Date.now(),
            timesPotentiallyIncluded: 0
        }

        const userOperationResults: BundleResult = {
            status: "success",
            userOperations: opsToBundle.map((sop) => sop.userOperation),
            rejectedUserOperations: failedOps.map(
                (sop) => sop.userOperationWithHash.userOperation
            ),
            transactionInfo
        }

        childLogger.info(
            {
                transactionRequest: {
                    ...transactionInfo.transactionRequest,
                    abi: undefined
                },
                txHash: transactionHash,
                opHashes: opsToBundle.map((owh) => owh.userOperationHash)
            },
            "submitted bundle transaction"
        )

        return userOperationResults
    }
}
