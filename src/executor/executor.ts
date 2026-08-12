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
    type SendTransactionErrorType,
    type SignedAuthorizationList,
    TransactionExecutionError
} from "viem"
import type { AltoConfig } from "../createConfig"
import { filterOpsAndEstimateGas } from "./filterOpsAndEstimateGas"
import {
    BundleAlreadyMinedError,
    encodeHandleOpsCalldata,
    getAuthorizationListFromUserOps,
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
            arbitrumBaseFeeMultiplier,
            skipLocalGasCalculations
        } = this.config

        // If skipLocalGasCalculations is enabled, use network gas price directly.
        // On chains where bundleGasUsed is underestimated, local calculations
        // inflate the break-even gas price resulting in bundles at a loss.
        if (skipLocalGasCalculations) {
            return {
                maxFeePerGas: networkGasPrice.maxFeePerGas,
                maxPriorityFeePerGas: networkGasPrice.maxPriorityFeePerGas
            }
        }

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
                maxFeePerGas: scaleBigIntByPercent(
                    scaledBaseFee,
                    arbitrumBaseFeeMultiplier
                ),
                maxPriorityFeePerGas: scaleBigIntByPercent(
                    scaledBaseFee,
                    arbitrumBaseFeeMultiplier
                )
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
        submissionAttempts,
        replacementTxHashes
    }: {
        txParam: HandleOpsTxParams
        gasOpts: HandleOpsGasParams
        childLogger: Logger
        submissionAttempts: number
        // When set, this send is a replacement of these previous transactions
        // and must keep the same nonce.
        replacementTxHashes?: HexData32[]
    }) {
        const {
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
            // Providing chainId lets viem skip its eth_fillTransaction and
            // eth_chainId round-trips before eth_sendRawTransaction.
            chainId: this.config.chainId,
            gas,
            account,
            nonce,
            ...gasOpts
        }

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
                            executor: request.account.address,
                            maxFeePerGas: request.maxFeePerGas,
                            maxPriorityFeePerGas: request.maxPriorityFeePerGas,
                            nonce: request.nonce
                        },
                        txHash: transactionHash,
                        isPrivate: usePrivateEndpoint
                    },
                    "submitted bundle transaction"
                )

                break
            } catch (e: unknown) {
                if (e instanceof BaseError) {
                    if (isTransactionUnderpricedError(e)) {
                        childLogger.warn("Transaction underpriced, retrying")

                        // A replacement must reuse its nonce - refetching here
                        // could pick up a nonce advanced by the transaction
                        // we are replacing and duplicate the bundle.
                        if (!replacementTxHashes) {
                            request.nonce =
                                await publicClient.getTransactionCount({
                                    address: account.address,
                                    blockTag: "latest"
                                })
                        }

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
                    childLogger.warn("max fee < basefee, retrying")

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
                        // If one of the bundle's own previous transactions
                        // consumed the nonce, the bundle already landed
                        // onchain - resending it would revert with AA25 and
                        // waste gas. If an unknown transaction consumed it,
                        // the userOps weren't executed and resending with a
                        // fresh nonce is safe.
                        if (replacementTxHashes) {
                            const minedTxHash = await Promise.any(
                                replacementTxHashes.map(async (hash) => {
                                    await publicClient.getTransactionReceipt({
                                        hash
                                    })
                                    return hash
                                })
                            ).catch(() => undefined)

                            if (minedTxHash) {
                                throw new BundleAlreadyMinedError(minedTxHash)
                            }
                        }

                        childLogger.warn("Nonce too low, retrying")
                        request.nonce = await publicClient.getTransactionCount({
                            address: request.from,
                            blockTag: "latest"
                        })
                    }

                    if (cause instanceof NonceTooHighError) {
                        childLogger.warn("Nonce too high, retrying")
                        request.nonce = await publicClient.getTransactionCount({
                            address: request.from,
                            blockTag: "latest"
                        })
                    }

                    if (cause instanceof IntrinsicGasTooLowError) {
                        childLogger.warn("Intrinsic gas too low, retrying")
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
        nonce,
        replacementTxHashes
    }: {
        executor: Account
        userOpBundle: UserOperationBundle
        networkGasPrice: GasPriceParameters
        networkBaseFee: bigint
        nonce: number
        // When set, this bundle replaces these previous transactions.
        replacementTxHashes?: HexData32[]
    }): Promise<BundleResult> {
        const { entryPoint, userOps } = userOpBundle

        let childLogger = this.logger.child({
            submissionAttempts: userOpBundle.submissionAttempts,
            userOperations: getUserOpHashes(userOps),
            entryPoint
        })

        const filterOpsResult = await filterOpsAndEstimateGas({
            checkEip7702AuthNonces: false, // Ignore EIP-7702 auth nonce check to save latency.
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
            userOps: getUserOpHashes(userOpsToBundle),
            submissionAttempts: userOpBundle.submissionAttempts,
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
            const authorizationList = getAuthorizationListFromUserOps(
                userOpsToBundle.map(({ userOp }) => userOp)
            )

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
                submissionAttempts: userOpBundle.submissionAttempts,
                replacementTxHashes
            })

            this.eventManager.emitSubmitted({
                userOpHashes: getUserOpHashes(userOpsToBundle),
                transactionHash
            })
        } catch (err: unknown) {
            const { rejectedUserOps, userOpsToBundle } = filterOpsResult

            // The bundle we are replacing already landed onchain, the caller
            // is responsible for resolving the userOps against the mined tx.
            if (err instanceof BundleAlreadyMinedError) {
                return {
                    success: false,
                    reason: "already_mined",
                    rejectedUserOps,
                    recoverableOps: []
                }
            }

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
