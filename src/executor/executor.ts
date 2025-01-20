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
    deriveUserOperation,
    type GasPriceParameters
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import {
    getRequiredPrefund,
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
    simulatedOpsToResults,
    isTransactionUnderpricedError,
    getAuthorizationList
} from "./utils"
import type { SendTransactionErrorType } from "viem"
import type { AltoConfig } from "../createConfig"
import type { SendTransactionOptions } from "./types"

export interface GasEstimateResult {
    preverificationGas: bigint
    verificationGasLimit: bigint
    callGasLimit: bigint
}

export type HandleOpsTxParam = {
    ops: PackedUserOperation[]
    isUserOpVersion06: boolean
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
            this.markWalletProcessed(transactionInfo.executor)
            return { status: "failed" }
        }

        newRequest.maxFeePerGas = maxBigInt(
            gasPriceParameters.maxFeePerGas,
            (newRequest.maxFeePerGas * 11n + 9n) / 10n
        )

        newRequest.maxPriorityFeePerGas = maxBigInt(
            gasPriceParameters.maxPriorityFeePerGas,
            (newRequest.maxPriorityFeePerGas * 11n + 9n) / 10n
        )
        newRequest.account = transactionInfo.executor

        const opsWithHashes = transactionInfo.userOperationInfos.map(
            (opInfo) => {
                const op = deriveUserOperation(opInfo.mempoolUserOperation)
                return {
                    mempoolUserOperation: opInfo.mempoolUserOperation,
                    userOperationHash: getUserOperationHash(
                        op,
                        transactionInfo.entryPoint,
                        this.config.walletClient.chain.id
                    ),
                    entryPoint: opInfo.entryPoint
                }
            }
        )

        const [isUserOpVersion06, entryPoint] = opsWithHashes.reduce(
            (acc, op) => {
                if (
                    acc[0] !==
                        isVersion06(op.mempoolUserOperation as UserOperation) ||
                    acc[1] !== op.entryPoint
                ) {
                    throw new Error(
                        "All user operations must be of the same version"
                    )
                }
                return acc
            },
            [
                isVersion06(
                    opsWithHashes[0].mempoolUserOperation as UserOperation
                ),
                opsWithHashes[0].entryPoint
            ]
        )

        const ep = getContract({
            abi: isUserOpVersion06 ? EntryPointV06Abi : EntryPointV07Abi,
            address: entryPoint,
            client: {
                public: this.config.publicClient,
                wallet: this.config.walletClient
            }
        })

        let { simulatedOps, gasLimit } = await filterOpsAndEstimateGas(
            transactionInfo.entryPoint,
            ep,
            transactionInfo.executor,
            opsWithHashes,
            newRequest.nonce,
            newRequest.maxFeePerGas,
            newRequest.maxPriorityFeePerGas,
            this.config.blockTagSupport ? "latest" : undefined,
            this.config.legacyTransactions,
            this.config.fixedGasLimitForEstimation,
            this.reputationManager,
            this.logger
        )

        const childLogger = this.logger.child({
            transactionHash: transactionInfo.transactionHash,
            executor: transactionInfo.executor.address
        })

        if (simulatedOps.length === 0) {
            childLogger.warn("no ops to bundle")
            this.markWalletProcessed(transactionInfo.executor)
            return { status: "failed" }
        }

        if (
            simulatedOps.every(
                (op) =>
                    op.reason === "AA25 invalid account nonce" ||
                    op.reason === "AA10 sender already constructed"
            )
        ) {
            childLogger.trace(
                { reasons: simulatedOps.map((sop) => sop.reason) },
                "all ops failed simulation with nonce error"
            )
            return { status: "potentially_already_included" }
        }

        if (simulatedOps.every((op) => op.reason !== undefined)) {
            childLogger.warn("all ops failed simulation")
            this.markWalletProcessed(transactionInfo.executor)
            return { status: "failed" }
        }

        const opsToBundle = simulatedOps
            .filter((op) => op.reason === undefined)
            .map((op) => {
                const opInfo = transactionInfo.userOperationInfos.find(
                    (info) =>
                        info.userOperationHash === op.owh.userOperationHash
                )
                if (!opInfo) {
                    throw new Error("opInfo not found")
                }
                return opInfo
            })

        if (this.config.localGasLimitCalculation) {
            gasLimit = opsToBundle.reduce((acc, opInfo) => {
                const userOperation = deriveUserOperation(
                    opInfo.mempoolUserOperation
                )
                return (
                    acc +
                    userOperation.preVerificationGas +
                    3n * userOperation.verificationGasLimit +
                    userOperation.callGasLimit
                )
            }, 0n)
        }

        // https://github.com/eth-infinitism/account-abstraction/blob/fa61290d37d079e928d92d53a122efcc63822214/contracts/core/EntryPoint.sol#L236
        let innerHandleOpFloor = 0n
        for (const owh of opsToBundle) {
            const op = deriveUserOperation(owh.mempoolUserOperation)
            innerHandleOpFloor +=
                op.callGasLimit + op.verificationGasLimit + 5000n
        }

        if (gasLimit < innerHandleOpFloor) {
            gasLimit += innerHandleOpFloor
        }

        // sometimes the estimation rounds down, adding a fixed constant accounts for this
        gasLimit += 10_000n

        // ensures that we don't submit again with too low of a gas value
        newRequest.gas = maxBigInt(newRequest.gas, gasLimit)

        // update calldata to include only ops that pass simulation
        let txParam: HandleOpsTxParam

        const userOps = opsToBundle.map((op) =>
            isUserOpVersion06
                ? op.mempoolUserOperation
                : toPackedUserOperation(
                      op.mempoolUserOperation as UserOperationV07
                  )
        ) as PackedUserOperation[]

        txParam = {
            isUserOpVersion06,
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
                    opsToBundle: opsToBundle.map(
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

            opsToBundle.map(({ entryPoint, mempoolUserOperation }) => {
                const op = deriveUserOperation(mempoolUserOperation)
                const chainId = this.config.publicClient.chain?.id
                const opHash = getUserOperationHash(
                    op,
                    entryPoint,
                    chainId as number
                )

                this.eventManager.emitSubmitted(opHash, txHash)
            })

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
                        mempoolUserOperation: opInfo.mempoolUserOperation,
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
            this.markWalletProcessed(transactionInfo.executor)

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

        let isTransactionUnderPriced = false
        let attempts = 0
        let transactionHash: Hex | undefined
        const maxAttempts = 3

        // Try sending the transaction and updating relevant fields if there is an error.
        while (attempts < maxAttempts) {
            try {
                transactionHash =
                    await this.config.walletClient.sendTransaction(request)

                break
            } catch (e: unknown) {
                isTransactionUnderPriced = false
                let isErrorHandled = false

                if (e instanceof BaseError) {
                    if (isTransactionUnderpricedError(e)) {
                        this.logger.warn("Transaction underpriced, retrying")

                        request.maxFeePerGas = scaleBigIntByPercent(
                            request.maxFeePerGas,
                            150
                        )
                        request.maxPriorityFeePerGas = scaleBigIntByPercent(
                            request.maxPriorityFeePerGas,
                            150
                        )
                        isErrorHandled = true
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
                        isErrorHandled = true
                    }

                    if (cause instanceof IntrinsicGasTooLowError) {
                        this.logger.warn("Intrinsic gas too low, retrying")
                        request.gas = scaleBigIntByPercent(request.gas, 150)
                        isErrorHandled = true
                    }

                    // This is thrown by OP-Stack chains that use proxyd.
                    // ref: https://github.com/ethereum-optimism/optimism/issues/2618#issuecomment-1630272888
                    if (cause.details?.includes("no backends available")) {
                        this.logger.warn(
                            "no backends avaiable error, retrying after 500ms"
                        )
                        await new Promise((resolve) => setTimeout(resolve, 500))
                        isErrorHandled = true
                    }
                }

                if (attempts === maxAttempts || !isErrorHandled) {
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
            this.mempool.add(op.mempoolUserOperation, op.entryPoint)
        })

        if (conflictingOps.length > 0) {
            this.markWalletProcessed(executor)
        }
    }

    async bundle(
        entryPoint: Address,
        ops: UserOperation[]
    ): Promise<BundleResult[]> {
        const wallet = await this.senderManager.getWallet()

        const opsWithHashes = ops.map((op) => {
            return {
                mempoolUserOperation: op,
                userOperationHash: getUserOperationHash(
                    deriveUserOperation(op),
                    entryPoint,
                    this.config.walletClient.chain.id
                )
            }
        })

        const isUserOpVersion06 = opsWithHashes.reduce(
            (acc, op) => {
                if (
                    acc !==
                    isVersion06(op.mempoolUserOperation as UserOperation)
                ) {
                    throw new Error(
                        "All user operations must be of the same version"
                    )
                }
                return acc
            },
            isVersion06(opsWithHashes[0].mempoolUserOperation as UserOperation)
        )

        const ep = getContract({
            abi: isUserOpVersion06 ? EntryPointV06Abi : EntryPointV07Abi,
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
            return opsWithHashes.map((owh) => {
                return {
                    status: "resubmit",
                    info: {
                        entryPoint,
                        userOpHash: owh.userOperationHash,
                        userOperation: owh.mempoolUserOperation,
                        reason: "Failed to get parameters for bundling"
                    }
                }
            })
        }

        let { gasLimit, simulatedOps } = await filterOpsAndEstimateGas(
            entryPoint,
            ep,
            wallet,
            opsWithHashes,
            nonce,
            gasPriceParameters.maxFeePerGas,
            gasPriceParameters.maxPriorityFeePerGas,
            this.config.blockTagSupport ? "pending" : undefined,
            this.config.legacyTransactions,
            this.config.fixedGasLimitForEstimation,
            this.reputationManager,
            childLogger,
            getAuthorizationList(
                opsWithHashes.map(
                    ({ mempoolUserOperation }) => mempoolUserOperation
                )
            )
        )

        if (simulatedOps.length === 0) {
            childLogger.error(
                "gas limit simulation encountered unexpected failure"
            )
            this.markWalletProcessed(wallet)
            return opsWithHashes.map(
                ({ userOperationHash, mempoolUserOperation }) => {
                    return {
                        status: "failure",
                        error: {
                            entryPoint,
                            userOpHash: userOperationHash,
                            userOperation: mempoolUserOperation,
                            reason: "INTERNAL FAILURE"
                        }
                    }
                }
            )
        }

        if (simulatedOps.every((op) => op.reason !== undefined)) {
            childLogger.warn("all ops failed simulation")
            this.markWalletProcessed(wallet)
            return simulatedOps.map(({ reason, owh }) => {
                return {
                    status: "failure",
                    error: {
                        entryPoint,
                        userOpHash: owh.userOperationHash,
                        userOperation: owh.mempoolUserOperation,
                        reason: reason as string
                    }
                }
            })
        }

        const opsWithHashToBundle = simulatedOps
            .filter((op) => op.reason === undefined)
            .map((op) => op.owh)

        childLogger = this.logger.child({
            userOperations: opsWithHashToBundle.map(
                (owh) => owh.userOperationHash
            ),
            entryPoint
        })

        // https://github.com/eth-infinitism/account-abstraction/blob/fa61290d37d079e928d92d53a122efcc63822214/contracts/core/EntryPoint.sol#L236
        let innerHandleOpFloor = 0n
        let totalBeneficiaryFees = 0n
        for (const owh of opsWithHashToBundle) {
            const op = deriveUserOperation(owh.mempoolUserOperation)
            innerHandleOpFloor +=
                op.callGasLimit + op.verificationGasLimit + 5000n

            totalBeneficiaryFees += getRequiredPrefund(op)
        }

        if (gasLimit < innerHandleOpFloor) {
            gasLimit += innerHandleOpFloor
        }

        // sometimes the estimation rounds down, adding a fixed constant accounts for this
        gasLimit += 10_000n

        childLogger.debug({ gasLimit }, "got gas limit")

        let transactionHash: HexData32
        try {
            const isLegacyTransaction = this.config.legacyTransactions

            if (this.config.noProfitBundling) {
                const gasPrice = totalBeneficiaryFees / gasLimit
                if (isLegacyTransaction) {
                    gasPriceParameters.maxFeePerGas = gasPrice
                    gasPriceParameters.maxPriorityFeePerGas = gasPrice
                } else {
                    gasPriceParameters.maxFeePerGas = maxBigInt(
                        gasPrice,
                        gasPriceParameters.maxFeePerGas || 0n
                    )
                }
            }

            const authorizationList = getAuthorizationList(
                opsWithHashToBundle.map(
                    ({ mempoolUserOperation }) => mempoolUserOperation
                )
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

            const userOps = opsWithHashToBundle.map(
                ({ mempoolUserOperation }) => {
                    const op = deriveUserOperation(mempoolUserOperation)

                    if (isUserOpVersion06) {
                        return op
                    }

                    return toPackedUserOperation(op as UserOperationV07)
                }
            ) as PackedUserOperation[]

            transactionHash = await this.sendHandleOpsTransaction({
                txParam: {
                    ops: userOps,
                    isUserOpVersion06,
                    entryPoint
                },
                opts
            })

            opsWithHashToBundle.map(({ userOperationHash }) => {
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
                return opsWithHashToBundle.map((owh) => {
                    return {
                        status: "resubmit",
                        info: {
                            entryPoint,
                            userOpHash: owh.userOperationHash,
                            userOperation: owh.mempoolUserOperation,
                            reason: InsufficientFundsError.name
                        }
                    }
                })
            }

            sentry.captureException(err)
            childLogger.error(
                { error: JSON.stringify(err) },
                "error submitting bundle transaction"
            )
            this.markWalletProcessed(wallet)
            return opsWithHashes.map((owh) => {
                return {
                    status: "failure",
                    error: {
                        entryPoint,
                        userOpHash: owh.userOperationHash,
                        userOperation: owh.mempoolUserOperation,
                        reason: "INTERNAL FAILURE"
                    }
                }
            })
        }

        const userOperationInfos = opsWithHashToBundle.map((op) => {
            return {
                entryPoint,
                mempoolUserOperation: op.mempoolUserOperation,
                userOperationHash: op.userOperationHash,
                lastReplaced: Date.now(),
                firstSubmitted: Date.now()
            }
        })

        const transactionInfo: TransactionInfo = {
            entryPoint,
            isVersion06: isUserOpVersion06,
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

        const userOperationResults: BundleResult[] = simulatedOpsToResults(
            simulatedOps,
            transactionInfo
        )

        childLogger.info(
            {
                transactionRequest: {
                    ...transactionInfo.transactionRequest,
                    abi: undefined
                },
                txHash: transactionHash,
                opHashes: opsWithHashToBundle.map(
                    (owh) => owh.userOperationHash
                )
            },
            "submitted bundle transaction"
        )

        return userOperationResults
    }
}
