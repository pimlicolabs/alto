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
import { isTransactionUnderpricedError, getAuthorizationList } from "./utils"
import type { SendTransactionErrorType } from "viem"
import type { AltoConfig } from "../createConfig"
import type { SendTransactionOptions } from "./types"
import { sendPflConditional } from "./fastlane"
import { filterOpsAndEstimateGas } from "./filterOpsAndEStimateGas"

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
        reputationManager,
        metrics,
        gasPriceManager,
        eventManager
    }: {
        config: AltoConfig
        mempool: MemoryMempool
        reputationManager: InterfaceReputationManager
        metrics: Metrics
        gasPriceManager: GasPriceManager
        eventManager: EventManager
    }) {
        this.config = config
        this.mempool = mempool
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

    async replaceTransaction(
        transactionInfo: TransactionInfo
    ): Promise<ReplaceTransactionResult> {
        const {
            isVersion06,
            entryPoint,
            transactionRequest,
            userOperationInfos
        } = transactionInfo

        let gasPriceParameters: GasPriceParameters
        try {
            gasPriceParameters =
                await this.gasPriceManager.tryGetNetworkGasPrice()
        } catch (err) {
            this.logger.error({ error: err }, "Failed to get network gas price")
            return { status: "failed" }
        }

        const newRequest = {
            ...transactionRequest,
            maxFeePerGas: scaleBigIntByPercent(
                gasPriceParameters.maxFeePerGas,
                115n
            ),
            maxPriorityFeePerGas: scaleBigIntByPercent(
                gasPriceParameters.maxPriorityFeePerGas,
                115n
            )
        }

        const opsToResubmit = userOperationInfos.map(
            (optr) => optr.userOperation
        )

        const ep = getContract({
            abi: isVersion06 ? EntryPointV06Abi : EntryPointV07Abi,
            address: entryPoint,
            client: {
                public: this.config.publicClient,
                wallet: this.config.walletClient
            }
        })

        const childLogger = this.logger.child({
            transactionHash: transactionInfo.transactionHash,
            executor: transactionInfo.transactionRequest.account.address
        })

        let bundleResult = await filterOpsAndEstimateGas({
            ep,
            isUserOpV06: isVersion06,
            wallet: newRequest.account,
            ops: opsToResubmit,
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
            isVersion06 ? op : toPackedUserOperation(op as UserOperationV07)
        ) as PackedUserOperation[]

        txParam = {
            isUserOpVersion06: isVersion06,
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
                    userOperations: this.getOpHashes(opsToBundle)
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

            this.eventManager.emitSubmitted({
                userOpHashes: this.getOpHashes(opsToBundle),
                transactionHash: txHash
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
                userOperationInfos: opsToBundle.map((op) => {
                    return {
                        entryPoint,
                        userOperation: op,
                        userOperationHash: this.getOpHashes([op])[0],
                        lastReplaced: Date.now(),
                        firstSubmitted: transactionInfo.firstSubmitted
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

    getOpHashes(userOperations: UserOperation[]): HexData32[] {
        return userOperations.map((userOperation) => {
            return getUserOperationHash(
                userOperation,
                this.config.entrypoints[0],
                this.config.publicClient.chain.id
            )
        })
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
                const txSender = tx.transactionRequest.account.address

                return (
                    txSender === executor.address &&
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
        wallet: Account,
        entryPoint: Address,
        ops: UserOperation[]
    ): Promise<BundleResult> {
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
            userOperations: this.getOpHashes(ops),
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
            return {
                status: "bundle_resubmit",
                reason: "Failed to get parameters for bundling",
                userOpsBundled: ops
            }
        }

        let estimateResult = await filterOpsAndEstimateGas({
            isUserOpV06,
            ep,
            wallet,
            ops,
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
            return {
                status: "bundle_failure",
                reason: "INTERNAL FAILURE",
                userOpsBundled: ops
            }
        }

        let { gasLimit, opsToBundle, failedOps } = estimateResult

        if (opsToBundle.length === 0) {
            childLogger.warn("all ops failed simulation")
            return {
                status: "bundle_failure",
                reason: "INTERNAL FAILURE",
                userOpsBundled: ops
            }
        }

        // Update child logger with userOperations being sent for bundling.
        childLogger = this.logger.child({
            userOperations: this.getOpHashes(opsToBundle),
            entryPoint
        })

        // sometimes the estimation rounds down, adding a fixed constant accounts for this
        gasLimit += 10_000n

        let transactionHash: HexData32
        try {
            const isLegacyTransaction = this.config.legacyTransactions
            const authorizationList = getAuthorizationList(opsToBundle)

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

            // TODO: move this to a seperate utility
            const userOps = opsToBundle.map((op) => {
                if (isUserOpV06) {
                    return op
                }
                return toPackedUserOperation(op as UserOperationV07)
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

            this.eventManager.emitSubmitted({
                userOpHashes: this.getOpHashes(opsToBundle),
                transactionHash
            })
        } catch (err: unknown) {
            const e = parseViemError(err)
            if (e instanceof InsufficientFundsError) {
                childLogger.error(
                    { error: e },
                    "insufficient funds, not submitting transaction"
                )
                return {
                    status: "bundle_resubmit",
                    reason: InsufficientFundsError.name,
                    userOpsBundled: ops
                }
            }

            sentry.captureException(err)
            childLogger.error(
                { error: JSON.stringify(err) },
                "error submitting bundle transaction"
            )
            return {
                status: "bundle_failure",
                reason: "INTERNAL FAILURE",
                userOpsBundled: ops
            }
        }

        const userOperationInfos = opsToBundle.map((op) => {
            return {
                entryPoint,
                userOperation: op,
                userOperationHash: this.getOpHashes([op])[0],
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
            userOperationInfos,
            lastReplaced: Date.now(),
            firstSubmitted: Date.now(),
            timesPotentiallyIncluded: 0
        }

        const userOperationResults: BundleResult = {
            status: "bundle_success",
            userOpsBundled: opsToBundle,
            rejectedUserOperations: failedOps.map((sop) => ({
                userOperation: sop.userOperation,
                reason: sop.reason
            })),
            transactionInfo
        }

        childLogger.info(
            {
                transactionRequest: {
                    ...transactionInfo.transactionRequest,
                    abi: undefined
                },
                txHash: transactionHash,
                opHashes: this.getOpHashes(opsToBundle)
            },
            "submitted bundle transaction"
        )

        return userOperationResults
    }
}
