import type { EventManager, GasPriceManager } from "@alto/handlers"
import type { InterfaceReputationManager, Mempool } from "@alto/mempool"
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
    type GasPriceParameters,
    UserOperationBundle
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import {
    isVersion07,
    maxBigInt,
    parseViemError,
    scaleBigIntByPercent,
    toPackedUserOperation
} from "@alto/utils"
import * as sentry from "@sentry/node"
import { Mutex } from "async-mutex"
import {
    IntrinsicGasTooLowError,
    NonceTooLowError,
    TransactionExecutionError,
    encodeFunctionData,
    getContract,
    type Account,
    type Hex,
    NonceTooHighError,
    BaseError
} from "viem"
import { getAuthorizationList, isTransactionUnderpricedError } from "./utils"
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
    ops: UserOperation[]
    isUserOpV06: boolean
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

        this.mutex = new Mutex()
    }

    cancelOps(_entryPoint: Address, _ops: UserOperation[]): Promise<void> {
        throw new Error("Method not implemented.")
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
        const { isUserOpV06, ops, entryPoint } = txParam

        const packedOps = ops.map((op) => {
            if (isUserOpV06) {
                return op
            }
            return toPackedUserOperation(op as UserOperationV07)
        }) as PackedUserOperation[]

        const data = encodeFunctionData({
            abi: isUserOpV06 ? EntryPointV06Abi : EntryPointV07Abi,
            functionName: "handleOps",
            args: [packedOps, opts.account.address]
        })

        const request =
            await this.config.walletClient.prepareTransactionRequest({
                to: entryPoint,
                data,
                ...opts
            })

        request.gas = scaleBigIntByPercent(
            request.gas,
            this.config.executorGasMultiplier
        )

        let attempts = 0
        let transactionHash: Hex | undefined
        const maxAttempts = 3

        // Try sending the transaction and updating relevant fields if there is an error.
        while (attempts < maxAttempts) {
            try {
                if (
                    this.config.enableFastlane &&
                    isUserOpV06 &&
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

        // needed for TS
        if (!transactionHash) {
            throw new Error("Transaction hash not assigned")
        }

        return transactionHash as Hex
    }

    async bundle({
        wallet,
        bundle,
        nonce,
        gasPriceParameters,
        gasLimitSuggestion,
        isReplacementTx
    }: {
        wallet: Account
        bundle: UserOperationBundle
        nonce: number
        gasPriceParameters: GasPriceParameters
        gasLimitSuggestion?: bigint
        isReplacementTx: boolean
    }): Promise<BundleResult> {
        const { entryPoint, userOperations, version } = bundle

        const isUserOpV06 = version === "0.6"
        const ep = getContract({
            abi: isUserOpV06 ? EntryPointV06Abi : EntryPointV07Abi,
            address: entryPoint,
            client: {
                public: this.config.publicClient,
                wallet: this.config.walletClient
            }
        })

        let childLogger = this.logger.child({
            userOperations: userOperations.map((op) => op.hash),
            entryPoint
        })

        let estimateResult = await filterOpsAndEstimateGas({
            isUserOpV06,
            ops: userOperations,
            ep,
            wallet,
            nonce,
            maxFeePerGas: gasPriceParameters.maxFeePerGas,
            maxPriorityFeePerGas: gasPriceParameters.maxPriorityFeePerGas,
            reputationManager: this.reputationManager,
            config: this.config,
            logger: childLogger
        })

        if (estimateResult.status === "unexpected_failure") {
            childLogger.error(
                "gas limit simulation encountered unexpected failure"
            )
            return {
                status: "unhandled_simulation_failure",
                reason: "INTERNAL FAILURE"
            }
        }

        if (estimateResult.status === "all_ops_failed_simulation") {
            childLogger.warn("all ops failed simulation")
            return {
                status: "all_ops_failed_simulation",
                rejectedUserOps: estimateResult.failedOps
            }
        }

        let { gasLimit, opsToBundle, failedOps } = estimateResult

        // Update child logger with userOperations being sent for bundling.
        childLogger = this.logger.child({
            userOperations: opsToBundle.map((op) => op.hash),
            entryPoint
        })

        // Ensure that we don't submit with gas too low leading to AA95.
        // V6 source: https://github.com/eth-infinitism/account-abstraction/blob/fa61290d37d079e928d92d53a122efcc63822214/contracts/core/EntryPoint.sol#L236
        // V7 source: https://github.com/eth-infinitism/account-abstraction/blob/releases/v0.7/contracts/core/EntryPoint.sol
        let gasFloor = 0n
        for (const op of opsToBundle) {
            if (isVersion07(op)) {
                const totalGas =
                    op.callGasLimit +
                    (op.paymasterPostOpGasLimit || 0n) +
                    10_000n
                gasFloor += (totalGas * 64n) / 63n
            } else {
                gasFloor += op.callGasLimit + op.verificationGasLimit + 5000n
            }
        }

        if (gasLimit < gasFloor) {
            gasLimit += gasFloor
        }

        // sometimes the estimation rounds down, adding a fixed constant accounts for this
        gasLimit += 10_000n
        gasLimit = gasLimitSuggestion
            ? maxBigInt(gasLimit, gasLimitSuggestion)
            : gasLimit

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

            transactionHash = await this.sendHandleOpsTransaction({
                txParam: {
                    ops: opsToBundle,
                    isReplacementTx,
                    isUserOpV06,
                    entryPoint
                },
                opts
            })

            this.eventManager.emitSubmitted({
                userOpHashes: opsToBundle.map((op) => op.hash),
                transactionHash
            })
        } catch (err: unknown) {
            const e = parseViemError(err)

            const { failedOps, opsToBundle } = estimateResult
            if (e) {
                return {
                    rejectedUserOps: failedOps,
                    userOpsToBundle: opsToBundle,
                    status: "bundle_submission_failure",
                    reason: e
                }
            }

            sentry.captureException(err)
            childLogger.error(
                { error: JSON.stringify(err) },
                "error submitting bundle transaction"
            )
            return {
                rejectedUserOps: failedOps,
                userOpsToBundle: opsToBundle,
                status: "bundle_submission_failure",
                reason: "INTERNAL FAILURE"
            }
        }

        const bundleResult: BundleResult = {
            status: "bundle_success",
            userOpsBundled: opsToBundle,
            rejectedUserOps: failedOps,
            transactionHash,
            transactionRequest: {
                gas: gasLimit,
                maxFeePerGas: gasPriceParameters.maxFeePerGas,
                maxPriorityFeePerGas: gasPriceParameters.maxPriorityFeePerGas,
                nonce
            }
        }

        childLogger.info(
            {
                transactionRequest: bundleResult.transactionRequest,
                txHash: transactionHash,
                opHashes: opsToBundle.map((op) => op.hash)
            },
            "submitted bundle transaction"
        )

        return bundleResult
    }
}
