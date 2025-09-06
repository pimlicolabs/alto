import type { EventManager } from "@alto/handlers"
import type {
    Address,
    BundleResult,
    GasPriceParameters,
    HexData32,
    UserOpInfo,
    UserOperationBundle
} from "@alto/types"
import type { Logger } from "@alto/utils"
import {
    jsonStringifyWithBigint,
    maxBigInt,
    minBigInt,
    roundUpBigInt,
    scaleBigIntByPercent
} from "@alto/utils"
import * as sentry from "@sentry/node"
import {
    type Account,
    BaseError,
    ContractFunctionExecutionError,
    FeeCapTooLowError,
    type Hex,
    InsufficientFundsError,
    IntrinsicGasTooLowError,
    NonceTooHighError,
    NonceTooLowError,
    TransactionExecutionError
} from "viem"
import type { SendTransactionErrorType } from "viem"
import type { SignedAuthorizationList } from "viem"
import type { AltoConfig } from "../createConfig"
import { filterOpsAndEstimateGas } from "./filterOpsAndEstimateGas"
import {
    encodeHandleOpsCalldata,
    getAuthorizationList,
    getUserOpHashes,
    isTransactionUnderpricedError
} from "./utils"

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
    eventManager: EventManager

    constructor({
        config,
        eventManager
    }: {
        config: AltoConfig
        eventManager: EventManager
    }) {
        this.config = config
        this.logger = config.getLogger(
            { module: "executor" },
            {
                level: config.executorLogLevel || config.logLevel
            }
        )
        this.eventManager = eventManager
    }

    getBundleGasPrice({
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
    }): GasPriceParameters {
        const {
            bundlerInitialCommission,
            resubmitMultiplierCeiling,
            legacyTransactions,
            chainType,
            arbitrumGasBidMultiplier
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
                maxFeePerGas: scaledBaseFee * arbitrumGasBidMultiplier,
                maxPriorityFeePerGas: scaledBaseFee * arbitrumGasBidMultiplier
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
        gasOpts,
        childLogger,
        submissionAttempts
    }: {
        txParam: HandleOpsTxParams
        gasOpts: HandleOpsGasParams
        childLogger: Logger
        submissionAttempts: number
    }) {
        const {
            executorGasMultiplier,
            sendHandleOpsRetryCount,
            transactionUnderpricedMultiplier,
            walletClients,
            publicClient,
            privateEndpointSubmissionAttempts
        } = this.config

        // Use private wallet for configured number of attempts if available, then switch to public
        const usePrivateEndpoint =
            walletClients.private &&
            submissionAttempts < privateEndpointSubmissionAttempts
        const walletClient = usePrivateEndpoint
            ? walletClients.private
            : walletClients.public

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

                childLogger.info(
                    {
                        transactionRequest: {
                            maxFeePerGas: request.maxFeePerGas,
                            maxPriorityFeePerGas: request.maxPriorityFeePerGas,
                            nonce: request.nonce
                        },
                        txHash: transactionHash,
                        opHashes: getUserOpHashes(txParam.userOps),
                        isPrivate: usePrivateEndpoint
                    },
                    "submitted bundle transaction"
                )

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

        let childLogger = this.logger.child({
            submissionAttempts: userOpBundle.submissionAttempts,
            userOperations: getUserOpHashes(userOps),
            entryPoint
        })

        const filterOpsResult = await filterOpsAndEstimateGas({
            networkBaseFee,
            userOpBundle,
            config: this.config,
            logger: childLogger
        })

        if (filterOpsResult.status === "unhandled_error") {
            childLogger.error(
                "encountered unhandled failure during filterOps simulation"
            )
            return {
                success: false,
                reason: "filterops_failed",
                rejectedUserOps: filterOpsResult.rejectedUserOps,
                recoverableOps: []
            }
        }

        if (filterOpsResult.status === "all_ops_rejected") {
            childLogger.warn("all ops failed filterOps simulation")
            return {
                success: false,
                reason: "filterops_failed",
                rejectedUserOps: filterOpsResult.rejectedUserOps,
                recoverableOps: []
            }
        }

        const {
            userOpsToBundle,
            rejectedUserOps,
            bundleGasUsed,
            bundleGasLimit,
            totalBeneficiaryFees
        } = filterOpsResult

        // Update child logger with userOperations being sent for bundling.
        childLogger = this.logger.child({
            submissionAttempts: userOpBundle.submissionAttempts,
            userOperations: getUserOpHashes(userOpsToBundle),
            entryPoint
        })

        const { maxFeePerGas, maxPriorityFeePerGas } = this.getBundleGasPrice({
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
                childLogger,
                gasOpts,
                submissionAttempts: userOpBundle.submissionAttempts
            })

            this.eventManager.emitSubmitted({
                userOpHashes: getUserOpHashes(userOpsToBundle),
                transactionHash
            })
        } catch (err: unknown) {
            const { rejectedUserOps, userOpsToBundle } = filterOpsResult

            const isViemExecutionError =
                err instanceof ContractFunctionExecutionError ||
                err instanceof TransactionExecutionError

            // Unknown error, return INTERNAL FAILURE.
            if (!isViemExecutionError) {
                sentry.captureException(err)
                childLogger.error(
                    { err: JSON.stringify(err) },
                    "unknown error submitting bundle transaction"
                )
                return {
                    success: false,
                    reason: "generic_error",
                    rejectedUserOps,
                    recoverableOps: userOpsToBundle
                }
            }

            // Check if executor has insufficient funds
            const isInsufficientFundsError = err.walk(
                (e) => e instanceof InsufficientFundsError
            )
            if (isInsufficientFundsError) {
                childLogger.warn(
                    {
                        executor: executor.address,
                        err: jsonStringifyWithBigint(err)
                    },
                    "executor has insufficient funds"
                )
                return {
                    success: false,
                    reason: "insufficient_funds",
                    rejectedUserOps,
                    recoverableOps: userOpsToBundle
                }
            }

            childLogger.error(
                {
                    err: jsonStringifyWithBigint(err)
                },
                "error submitting bundle transaction"
            )

            return {
                success: false,
                reason: "generic_error",
                rejectedUserOps,
                recoverableOps: userOpsToBundle
            }
        }

        const userOpsBundled = userOpsToBundle

        const bundleResult: BundleResult = {
            success: true,
            userOpsBundled,
            rejectedUserOps,
            transactionHash,
            transactionRequest: {
                maxFeePerGas,
                maxPriorityFeePerGas,
                nonce
            }
        }

        return bundleResult
    }
}
