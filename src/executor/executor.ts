import type { EventManager, GasPriceManager } from "@alto/handlers"
import type { InterfaceReputationManager, Mempool } from "@alto/mempool"
import type {
    Address,
    BundleResult,
    HexData32,
    UserOperation,
    GasPriceParameters,
    UserOperationBundle,
    UserOpInfo
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import {
    roundUpBigInt,
    maxBigInt,
    parseViemError,
    scaleBigIntByPercent,
    minBigInt,
    jsonStringifyWithBigint
} from "@alto/utils"
import * as sentry from "@sentry/node"
import {
    IntrinsicGasTooLowError,
    NonceTooLowError,
    TransactionExecutionError,
    type Account,
    type Hex,
    NonceTooHighError,
    BaseError,
    FeeCapTooLowError,
    InsufficientFundsError
} from "viem"
import {
    encodeHandleOpsCalldata,
    getAuthorizationList,
    getUserOpHashes,
    isTransactionUnderpricedError
} from "./utils"
import type { SendTransactionErrorType } from "viem"
import type { AltoConfig } from "../createConfig"
import type { SignedAuthorizationList } from "viem"
import { filterOpsAndEstimateGas } from "./filterOpsAndEstimateGas"

type HandleOpsTxParams = {
    gas: bigint
    account: Account
    nonce: number
    userOps: UserOpInfo[]
    entryPoint: Address
}

type HandleOpsGasParams =
    | {
          type: "legacy"
          gasPrice: bigint
          maxFeePerGas?: undefined
          maxPriorityFeePerGas?: undefined
      }
    | {
          type: "eip1559"
          maxFeePerGas: bigint
          maxPriorityFeePerGas: bigint
          gasPrice?: undefined
      }
    | {
          type: "eip7702"
          maxFeePerGas: bigint
          maxPriorityFeePerGas: bigint
          gasPrice?: undefined
          authorizationList: SignedAuthorizationList
      }

export class Executor {
    config: AltoConfig
    logger: Logger
    metrics: Metrics
    reputationManager: InterfaceReputationManager
    gasPriceManager: GasPriceManager
    mempool: Mempool
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
        mempool: Mempool
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
    }

    cancelOps(_entryPoint: Address, _ops: UserOperation[]): Promise<void> {
        throw new Error("Method not implemented.")
    }

    async getBundleGasPrice({
        bundle,
        networkGasPrice,
        networkBaseFee,
        totalBeneficiaryFees,
        bundleGasUsed
    }: {
        bundle: UserOperationBundle
        networkGasPrice: GasPriceParameters
        networkBaseFee: bigint
        totalBeneficiaryFees: bigint
        bundleGasUsed: bigint
    }): Promise<GasPriceParameters> {
        const {
            bundlerInitialCommission,
            resubmitMultiplierCeiling,
            legacyTransactions,
            chainType
        } = this.config

        // Arbtirum's sequencer orders based on first come first serve.
        // Because of this, maxFee/maxPriorityFee is ignored and the bundler *always* pays the network's baseFee.
        // The bundler need to set a large enough gasBid to account for network baseFee fluctuations.
        // GasBid = min(maxFee, base + priority)
        if (chainType === "arbitrum") {
            const scaledBaseFee = scaleBigIntByPercent(
                networkBaseFee,
                100n + 20n * BigInt(bundle.submissionAttempts)
            )

            return {
                maxFeePerGas: scaledBaseFee * 2n,
                maxPriorityFeePerGas: scaledBaseFee * 2n
            }
        }

        // Increase network gas price for resubmissions to improve tx inclusion
        let [networkMaxFeePerGas, networkMaxPriorityFeePerGas] = [
            networkGasPrice.maxFeePerGas,
            networkGasPrice.maxPriorityFeePerGas
        ]

        if (bundle.submissionAttempts > 0) {
            const multiplier = 100n + BigInt(bundle.submissionAttempts) * 20n

            networkMaxFeePerGas = scaleBigIntByPercent(
                networkMaxFeePerGas,
                minBigInt(multiplier, resubmitMultiplierCeiling)
            )
            networkMaxPriorityFeePerGas = scaleBigIntByPercent(
                networkMaxPriorityFeePerGas,
                minBigInt(multiplier, resubmitMultiplierCeiling)
            )
        }

        // The bundler should place a gasBid that is competetive with the network's gasPrice.
        const breakEvenGasPrice = totalBeneficiaryFees / bundleGasUsed

        // Calculate commission: start at bundlerInitialCommission%, then
        // halve the commission with each resubmission attempt
        const currentCommission =
            bundlerInitialCommission / 2n ** BigInt(bundle.submissionAttempts)
        const pricingPercent = 100n - currentCommission

        const bundlingGasPrice = scaleBigIntByPercent(
            breakEvenGasPrice,
            pricingPercent
        )

        if (legacyTransactions) {
            const gasPrice = maxBigInt(bundlingGasPrice, networkMaxFeePerGas)
            return {
                maxFeePerGas: gasPrice,
                maxPriorityFeePerGas: gasPrice
            }
        }

        const effectiveGasPrice = minBigInt(
            networkMaxFeePerGas,
            networkBaseFee + networkMaxPriorityFeePerGas
        )

        if (bundlingGasPrice > effectiveGasPrice) {
            return {
                maxFeePerGas: bundlingGasPrice,
                maxPriorityFeePerGas: bundlingGasPrice
            }
        }

        return {
            maxFeePerGas: networkMaxFeePerGas,
            maxPriorityFeePerGas: networkMaxPriorityFeePerGas
        }
    }

    async sendHandleOpsTransaction({
        txParam,
        gasOpts
    }: {
        txParam: HandleOpsTxParams
        gasOpts: HandleOpsGasParams
    }) {
        const {
            executorGasMultiplier,
            sendHandleOpsRetryCount,
            transactionUnderpricedMultiplier,
            walletClient,
            publicClient
        } = this.config

        const { entryPoint, userOps, account, gas, nonce } = txParam

        const handleOpsCalldata = encodeHandleOpsCalldata({
            userOps: userOps.map(({ userOp }) => userOp),
            beneficiary: account.address
        })

        const request = {
            to: entryPoint,
            data: handleOpsCalldata,
            from: account.address,
            chain: publicClient.chain,
            gas,
            account,
            nonce,
            ...gasOpts
        }

        request.gas = scaleBigIntByPercent(request.gas, executorGasMultiplier)

        let attempts = 0
        let transactionHash: Hex | undefined
        const maxAttempts = sendHandleOpsRetryCount

        // Try sending the transaction and updating relevant fields if there is an error.
        while (attempts < maxAttempts) {
            try {
                // Round up gasLimit to nearest multiple
                request.gas = roundUpBigInt({
                    value: request.gas,
                    multiple: this.config.gasLimitRoundingMultiple
                })

                transactionHash = await walletClient.sendTransaction(request)

                break
            } catch (e: unknown) {
                if (e instanceof BaseError) {
                    if (isTransactionUnderpricedError(e)) {
                        this.logger.warn("Transaction underpriced, retrying")

                        request.nonce = await publicClient.getTransactionCount({
                            address: account.address,
                            blockTag: "latest"
                        })

                        if (request.maxFeePerGas) {
                            request.maxFeePerGas = scaleBigIntByPercent(
                                request.maxFeePerGas,
                                transactionUnderpricedMultiplier
                            )
                        }

                        if (request.maxPriorityFeePerGas) {
                            request.maxPriorityFeePerGas = scaleBigIntByPercent(
                                request.maxPriorityFeePerGas,
                                transactionUnderpricedMultiplier
                            )
                        }

                        if (request.gasPrice) {
                            request.gasPrice = scaleBigIntByPercent(
                                request.gasPrice,
                                transactionUnderpricedMultiplier
                            )
                        }
                    }
                }

                if (e instanceof FeeCapTooLowError) {
                    this.logger.warn("max fee < basefee, retrying")

                    if (request.gasPrice) {
                        request.gasPrice = scaleBigIntByPercent(
                            request.gasPrice,
                            125n
                        )
                    }

                    if (request.maxFeePerGas) {
                        request.maxFeePerGas = scaleBigIntByPercent(
                            request.maxFeePerGas,
                            125n
                        )
                    }

                    if (request.maxPriorityFeePerGas) {
                        request.maxPriorityFeePerGas = scaleBigIntByPercent(
                            request.maxPriorityFeePerGas,
                            125n
                        )
                    }
                }

                const error = e as SendTransactionErrorType

                if (error instanceof TransactionExecutionError) {
                    const cause = error.cause

                    if (cause instanceof NonceTooLowError) {
                        this.logger.warn("Nonce too low, retrying")
                        request.nonce = await publicClient.getTransactionCount({
                            address: request.from,
                            blockTag: "latest"
                        })
                    }

                    if (cause instanceof NonceTooHighError) {
                        this.logger.warn("Nonce too high, retrying")
                        request.nonce = await publicClient.getTransactionCount({
                            address: request.from,
                            blockTag: "latest"
                        })
                    }

                    if (cause instanceof IntrinsicGasTooLowError) {
                        this.logger.warn("Intrinsic gas too low, retrying")
                        request.gas = scaleBigIntByPercent(request.gas, 150n)
                    }
                }

                attempts++

                if (attempts === maxAttempts) {
                    throw error
                }
            }
        }

        // needed for TS
        if (!transactionHash) {
            throw new Error("Transaction hash not assigned")
        }

        return transactionHash as Hex
    }

    async bundle({
        executor,
        userOpBundle,
        networkGasPrice,
        networkBaseFee,
        nonce
    }: {
        executor: Account
        userOpBundle: UserOperationBundle
        networkGasPrice: GasPriceParameters
        networkBaseFee: bigint
        nonce: number
    }): Promise<BundleResult> {
        const { entryPoint, userOps } = userOpBundle

        const isReplacementTx = userOpBundle.submissionAttempts > 0
        let childLogger = this.logger.child({
            isReplacementTx,
            userOperations: getUserOpHashes(userOps),
            entryPoint
        })

        let filterOpsResult = await filterOpsAndEstimateGas({
            gasPriceManager: this.gasPriceManager,
            userOpBundle,
            config: this.config,
            logger: childLogger
        })

        if (filterOpsResult.status === "unhandled_error") {
            childLogger.error("encountered unexpected failure during filterOps")
            return {
                status: "filterops_unhandled_error",
                rejectedUserOps: filterOpsResult.rejectedUserOps
            }
        }

        if (filterOpsResult.status === "all_ops_rejected") {
            childLogger.warn("all ops failed simulation")
            return {
                status: "filterops_all_rejected",
                rejectedUserOps: filterOpsResult.rejectedUserOps
            }
        }

        let {
            userOpsToBundle,
            rejectedUserOps,
            bundleGasUsed,
            bundleGasLimit,
            totalBeneficiaryFees
        } = filterOpsResult

        // Update child logger with userOperations being sent for bundling.
        childLogger = this.logger.child({
            isReplacementTx,
            userOperations: getUserOpHashes(userOpsToBundle),
            entryPoint
        })

        const { maxFeePerGas, maxPriorityFeePerGas } =
            await this.getBundleGasPrice({
                bundle: userOpBundle,
                networkGasPrice,
                networkBaseFee,
                totalBeneficiaryFees,
                bundleGasUsed
            })

        let transactionHash: HexData32
        try {
            const isLegacyTransaction = this.config.legacyTransactions
            const authorizationList = getAuthorizationList(userOpsToBundle)

            let gasOpts: HandleOpsGasParams
            if (isLegacyTransaction) {
                gasOpts = {
                    type: "legacy",
                    gasPrice: maxFeePerGas
                }
            } else if (authorizationList) {
                gasOpts = {
                    type: "eip7702",
                    maxFeePerGas,
                    maxPriorityFeePerGas,
                    authorizationList
                }
            } else {
                gasOpts = {
                    type: "eip1559",
                    maxFeePerGas,
                    maxPriorityFeePerGas
                }
            }

            transactionHash = await this.sendHandleOpsTransaction({
                txParam: {
                    account: executor,
                    nonce,
                    gas: bundleGasLimit,
                    userOps: userOpsToBundle,
                    entryPoint
                },
                gasOpts
            })

            this.eventManager.emitSubmitted({
                userOpHashes: getUserOpHashes(userOpsToBundle),
                transactionHash
            })
        } catch (err: unknown) {
            const e = parseViemError(err)
            const { rejectedUserOps, userOpsToBundle } = filterOpsResult

            // if unknown error, return INTERNAL FAILURE
            if (!e) {
                sentry.captureException(err)
                childLogger.error(
                    { err: JSON.stringify(err) },
                    "unknown error submitting bundle transaction"
                )
                return {
                    rejectedUserOps,
                    userOpsToBundle,
                    status: "submission_generic_error",
                    reason: "INTERNAL FAILURE"
                }
            }

            // Check if executor has insufficient funds
            if (e instanceof InsufficientFundsError) {
                childLogger.warn(
                    {
                        executor: executor.address,
                        err: jsonStringifyWithBigint(err)
                    },
                    "executor has insufficient funds"
                )
                return {
                    rejectedUserOps,
                    userOpsToBundle,
                    status: "submission_insufficient_funds_error"
                }
            }

            childLogger.error(
                {
                    err: jsonStringifyWithBigint(err)
                },
                "error submitting bundle transaction"
            )

            return {
                rejectedUserOps,
                userOpsToBundle,
                status: "submission_generic_error",
                reason: e
            }
        }

        const userOpsBundled = userOpsToBundle

        const bundleResult: BundleResult = {
            status: "submission_success",
            userOpsBundled,
            rejectedUserOps,
            transactionHash,
            transactionRequest: {
                gas: bundleGasLimit,
                maxFeePerGas,
                maxPriorityFeePerGas,
                nonce
            }
        }

        childLogger.info(
            {
                transactionRequest: bundleResult.transactionRequest,
                txHash: transactionHash,
                opHashes: getUserOpHashes(userOpsBundled)
            },
            "submitted bundle transaction"
        )

        return bundleResult
    }
}
