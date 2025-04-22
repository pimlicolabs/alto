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
    scaleBigIntByPercent
} from "@alto/utils"
import * as sentry from "@sentry/node"
import {
    IntrinsicGasTooLowError,
    NonceTooLowError,
    TransactionExecutionError,
    type Account,
    type Hex,
    NonceTooHighError,
    BaseError
} from "viem"
import {
    calculateAA95GasFloor,
    encodeHandleOpsCalldata,
    getAuthorizationList,
    getUserOpHashes,
    isTransactionUnderpricedError
} from "./utils"
import type { SendTransactionErrorType } from "viem"
import type { AltoConfig } from "../createConfig"
import { sendPflConditional } from "./fastlane"
import type { SignedAuthorizationList } from "viem"
import { filterOpsAndEstimateGas } from "./filterOpsAndEStimateGas"

type HandleOpsTxParams = {
    gas: bigint
    account: Account
    nonce: number
    userOps: UserOpInfo[]
    isUserOpV06: boolean
    isReplacementTx: boolean
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

    async sendHandleOpsTransaction({
        txParam,
        gasOpts
    }: {
        txParam: HandleOpsTxParams
        gasOpts: HandleOpsGasParams
    }) {
        const { entryPoint, userOps, account, gas, nonce, isUserOpV06 } =
            txParam

        const {
            executorGasMultiplier,
            sendHandleOpsRetryCount,
            transactionUnderpricedMultiplier,
            enableFastlane,
            walletClient,
            publicClient
        } = this.config

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
                if (
                    enableFastlane &&
                    isUserOpV06 &&
                    !txParam.isReplacementTx &&
                    attempts === 0
                ) {
                    const serializedTransaction =
                        await walletClient.signTransaction(request)

                    transactionHash = await sendPflConditional({
                        serializedTransaction,
                        publicClient,
                        walletClient,
                        logger: this.logger
                    })

                    break
                }

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

                        if (
                            request.maxFeePerGas &&
                            request.maxPriorityFeePerGas
                        ) {
                            request.maxFeePerGas = scaleBigIntByPercent(
                                request.maxFeePerGas,
                                transactionUnderpricedMultiplier
                            )
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

                    // This is thrown by OP-Stack chains that use proxyd.
                    // ref: https://github.com/ethereum-optimism/optimism/issues/2618#issuecomment-1630272888
                    if (cause.details?.includes("no backends available")) {
                        this.logger.warn(
                            "no backends avaiable error, retrying after 500ms"
                        )
                        await new Promise((resolve) => setTimeout(resolve, 500))
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
        nonce,
        gasPriceParams,
        gasLimitSuggestion,
        isReplacementTx
    }: {
        executor: Account
        userOpBundle: UserOperationBundle
        nonce: number
        gasPriceParams: GasPriceParameters
        gasLimitSuggestion?: bigint
        isReplacementTx: boolean
    }): Promise<BundleResult> {
        const { entryPoint, userOps, version } = userOpBundle
        const { maxFeePerGas, maxPriorityFeePerGas } = gasPriceParams
        const isUserOpV06 = version === "0.6"

        let childLogger = this.logger.child({
            isReplacementTx,
            userOperations: getUserOpHashes(userOps),
            entryPoint
        })

        let estimateResult = await filterOpsAndEstimateGas({
            userOpBundle,
            executor,
            nonce,
            maxFeePerGas,
            maxPriorityFeePerGas,
            codeOverrideSupport: this.config.codeOverrideSupport,
            reputationManager: this.reputationManager,
            config: this.config,
            logger: childLogger
        })

        if (estimateResult.status === "unhandled_failure") {
            childLogger.error(
                "gas limit simulation encountered unexpected failure"
            )
            return {
                status: "unhandled_simulation_failure",
                rejectedUserOps: estimateResult.rejectedUserOps,
                reason: "INTERNAL FAILURE"
            }
        }

        if (estimateResult.status === "all_ops_failed_simulation") {
            childLogger.warn("all ops failed simulation")
            return {
                status: "all_ops_failed_simulation",
                rejectedUserOps: estimateResult.rejectedUserOps
            }
        }

        let { gasLimit, userOpsToBundle, rejectedUserOps } = estimateResult

        // Update child logger with userOperations being sent for bundling.
        childLogger = this.logger.child({
            isReplacementTx,
            userOperations: getUserOpHashes(userOpsToBundle),
            entryPoint
        })

        // Ensure that we don't submit with gas too low leading to AA95.
        const aa95GasFloor = calculateAA95GasFloor({
            userOps: userOpsToBundle.map(({ userOp }) => userOp),
            beneficiary: executor.address
        })
        gasLimit = maxBigInt(gasLimit, aa95GasFloor)

        // sometimes the estimation rounds down, adding a fixed constant accounts for this
        gasLimit += 10_000n
        gasLimit = gasLimitSuggestion
            ? maxBigInt(gasLimit, gasLimitSuggestion)
            : gasLimit

        let transactionHash: HexData32
        try {
            const isLegacyTransaction = this.config.legacyTransactions
            const authorizationList = getAuthorizationList(userOpsToBundle)
            const { maxFeePerGas, maxPriorityFeePerGas } = gasPriceParams

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
                    gas: gasLimit,
                    userOps: userOpsToBundle,
                    isReplacementTx,
                    isUserOpV06,
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
            const { rejectedUserOps, userOpsToBundle } = estimateResult

            // if unknown error, return INTERNAL FAILURE
            if (!e) {
                sentry.captureException(err)
                childLogger.error(
                    { error: JSON.stringify(err) },
                    "unknown error submitting bundle transaction"
                )
                return {
                    rejectedUserOps,
                    userOpsToBundle,
                    status: "bundle_submission_failure",
                    reason: "INTERNAL FAILURE"
                }
            }

            childLogger.error(
                {
                    err: JSON.stringify(err, (_key, value) =>
                        typeof value === "bigint" ? value.toString() : value
                    )
                },
                "error submitting bundle transaction"
            )

            return {
                rejectedUserOps,
                userOpsToBundle,
                status: "bundle_submission_failure",
                reason: e
            }
        }

        const userOpsBundled = userOpsToBundle

        const bundleResult: BundleResult = {
            status: "bundle_success",
            userOpsBundled,
            rejectedUserOps,
            transactionHash,
            transactionRequest: {
                gas: gasLimit,
                maxFeePerGas: gasPriceParams.maxFeePerGas,
                maxPriorityFeePerGas: gasPriceParams.maxPriorityFeePerGas,
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
