import type {
    DefaultFilterOpsAndEstimateGasParams,
    SenderManager
} from "@alto/executor"
import type {
    CompressionHandler,
    EventManager,
    GasPriceManager
} from "@alto/handlers"
import type { InterfaceReputationManager } from "@alto/mempool"
import {
    type Address,
    type BundleResult,
    type CompressedUserOperation,
    EntryPointV06Abi,
    EntryPointV07Abi,
    type HexData32,
    type PackedUserOperation,
    type TransactionInfo,
    type UserOperation,
    type UserOperationV06,
    type UserOperationV07,
    type UserOperationWithHash,
    deriveUserOperation
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import {
    getRequiredPrefund,
    getUserOperationHash,
    isVersion06,
    maxBigInt,
    parseViemError,
    toPackedUserOperation
} from "@alto/utils"
import * as sentry from "@sentry/node"
import { Mutex } from "async-mutex"
import {
    type Account,
    FeeCapTooLowError,
    InsufficientFundsError,
    IntrinsicGasTooLowError,
    NonceTooLowError,
    encodeFunctionData,
    getContract
} from "viem"
import {
    type CompressedFilterOpsAndEstimateGasParams,
    createCompressedCalldata,
    filterOpsAndEstimateGas,
    flushStuckTransaction,
    simulatedOpsToResults
} from "./utils"
import type { AltoConfig } from "../createConfig"

export interface GasEstimateResult {
    preverificationGas: bigint
    verificationGasLimit: bigint
    callGasLimit: bigint
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
    compressionHandler: CompressionHandler | null
    gasPriceManager: GasPriceManager
    mutex: Mutex
    eventManager: EventManager

    constructor({
        config,
        senderManager,
        reputationManager,
        metrics,
        compressionHandler,
        gasPriceManager,
        eventManager
    }: {
        config: AltoConfig
        senderManager: SenderManager
        reputationManager: InterfaceReputationManager
        metrics: Metrics
        compressionHandler: CompressionHandler | null
        gasPriceManager: GasPriceManager
        eventManager: EventManager
    }) {
        this.config = config
        this.senderManager = senderManager
        this.reputationManager = reputationManager
        this.logger = config.getLogger(
            { module: "executor" },
            {
                level: config.executorLogLevel || config.logLevel
            }
        )
        this.metrics = metrics
        this.compressionHandler = compressionHandler
        this.gasPriceManager = gasPriceManager
        this.eventManager = eventManager

        this.mutex = new Mutex()
    }

    getCompressionHandler(): CompressionHandler {
        if (!this.compressionHandler) {
            throw new Error(
                "Support for compressed bundles has not initialized"
            )
        }
        return this.compressionHandler
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

        const gasPriceParameters = await this.gasPriceManager.getGasPrice()

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

        let callContext:
            | DefaultFilterOpsAndEstimateGasParams
            | CompressedFilterOpsAndEstimateGasParams

        if (transactionInfo.transactionType === "default") {
            const [isUserOpVersion06, entryPoint] = opsWithHashes.reduce(
                (acc, op) => {
                    if (
                        acc[0] !==
                            isVersion06(
                                op.mempoolUserOperation as UserOperation
                            ) ||
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

            callContext = {
                ep,
                type: "default"
            }
        } else {
            const compressionHandler = this.getCompressionHandler()

            callContext = {
                publicClient: this.config.publicClient,
                bundleBulker: compressionHandler.bundleBulkerAddress,
                perOpInflatorId: compressionHandler.perOpInflatorId,
                type: "compressed"
            }
        }

        let { simulatedOps, gasLimit } = await filterOpsAndEstimateGas(
            transactionInfo.entryPoint,
            callContext,
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
        if (transactionInfo.transactionType === "default") {
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
                isVersion06(
                    opsWithHashes[0].mempoolUserOperation as UserOperation
                )
            )

            newRequest.data = isUserOpVersion06
                ? encodeFunctionData({
                      abi: EntryPointV06Abi,
                      functionName: "handleOps",
                      args: [
                          opsToBundle.map(
                              (opInfo) =>
                                  opInfo.mempoolUserOperation as UserOperationV06
                          ),
                          transactionInfo.executor.address
                      ]
                  })
                : encodeFunctionData({
                      abi: EntryPointV07Abi,
                      functionName: "handleOps",
                      args: [
                          opsToBundle.map((opInfo) =>
                              toPackedUserOperation(
                                  opInfo.mempoolUserOperation as UserOperationV07
                              )
                          ),
                          transactionInfo.executor.address
                      ]
                  })
        } else if (transactionInfo.transactionType === "compressed") {
            const compressedOps = opsToBundle.map(
                (opInfo) =>
                    opInfo.mempoolUserOperation as CompressedUserOperation
            )
            newRequest.data = createCompressedCalldata(
                compressedOps,
                this.getCompressionHandler().perOpInflatorId
            )
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

            const txHash = await this.config.walletClient.sendTransaction(
                this.config.legacyTransactions
                    ? {
                          ...newRequest,
                          gasPrice: newRequest.maxFeePerGas,
                          maxFeePerGas: undefined,
                          maxPriorityFeePerGas: undefined,
                          type: "legacy",
                          accessList: undefined
                      }
                    : newRequest
            )

            opsToBundle.map((opToBundle) => {
                const op = deriveUserOperation(opToBundle.mempoolUserOperation)
                const chainId = this.config.publicClient.chain?.id
                const opHash = getUserOperationHash(
                    op,
                    opToBundle.entryPoint,
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

        const gasPrice = await this.gasPriceManager.getGasPrice()
        const promises = wallets.map((wallet) => {
            flushStuckTransaction(
                this.config.publicClient,
                this.config.walletClient,
                wallet,
                gasPrice.maxFeePerGas * 5n,
                this.logger
            )
        })

        await Promise.all(promises)
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
                    op,
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

        const gasPriceParameters = await this.gasPriceManager.getGasPrice()
        childLogger.debug({ gasPriceParameters }, "got gas price")

        const nonce = await this.config.publicClient.getTransactionCount({
            address: wallet.address,
            blockTag: "pending"
        })
        childLogger.trace({ nonce }, "got nonce")

        const callContext: DefaultFilterOpsAndEstimateGasParams = {
            ep,
            type: "default"
        }

        let { gasLimit, simulatedOps } = await filterOpsAndEstimateGas(
            entryPoint,
            callContext,
            wallet,
            opsWithHashes,
            nonce,
            gasPriceParameters.maxFeePerGas,
            gasPriceParameters.maxPriorityFeePerGas,
            this.config.blockTagSupport ? "pending" : undefined,
            this.config.legacyTransactions,
            this.config.fixedGasLimitForEstimation,
            this.reputationManager,
            childLogger
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

            const gasOptions = isLegacyTransaction
                ? { gasPrice: gasPriceParameters.maxFeePerGas }
                : {
                      maxFeePerGas: gasPriceParameters.maxFeePerGas,
                      maxPriorityFeePerGas:
                          gasPriceParameters.maxPriorityFeePerGas
                  }

            if (this.config.noProfitBundling) {
                const gasPrice = totalBeneficiaryFees / gasLimit
                if (isLegacyTransaction) {
                    gasOptions.gasPrice = gasPrice
                } else {
                    gasOptions.maxFeePerGas = maxBigInt(
                        gasPrice,
                        gasOptions.maxFeePerGas || 0n
                    )
                }
            }

            const opts = {
                account: wallet,
                gas: gasLimit,
                nonce: nonce,
                ...gasOptions
            }

            const userOps = opsWithHashToBundle.map((owh) =>
                isUserOpVersion06
                    ? owh.mempoolUserOperation
                    : toPackedUserOperation(
                          owh.mempoolUserOperation as UserOperationV07
                      )
            ) as PackedUserOperation[]

            transactionHash = await ep.write.handleOps(
                [userOps, wallet.address],
                opts
            )

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

            if (
                e?.details
                    ?.toLowerCase()
                    .includes("replacement transaction underpriced")
            ) {
                childLogger.error(
                    { error: e },
                    "replacement transaction underpriced"
                )
                this.markWalletProcessed(wallet)
                return opsWithHashToBundle.map((owh) => {
                    return {
                        status: "resubmit",
                        info: {
                            entryPoint,
                            userOpHash: owh.userOperationHash,
                            userOperation: owh.mempoolUserOperation,
                            reason: "replacement transaction underpriced"
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
            transactionType: "default",
            transactionHash: transactionHash,
            previousTransactionHashes: [],
            transactionRequest: {
                account: wallet,
                to: ep.address,
                data: isUserOpVersion06
                    ? encodeFunctionData({
                          abi: ep.abi,
                          functionName: "handleOps",
                          args: [
                              opsWithHashToBundle.map(
                                  (owh) =>
                                      owh.mempoolUserOperation as UserOperationV06
                              ),
                              wallet.address
                          ]
                      })
                    : encodeFunctionData({
                          abi: ep.abi,
                          functionName: "handleOps",
                          args: [
                              opsWithHashToBundle.map((owh) =>
                                  toPackedUserOperation(
                                      owh.mempoolUserOperation as UserOperationV07
                                  )
                              ),
                              wallet.address
                          ]
                      }),
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

    async bundleCompressed(
        entryPoint: Address,
        compressedOps: CompressedUserOperation[]
    ): Promise<BundleResult[]> {
        const compressionHandler = this.getCompressionHandler()
        const wallet = await this.senderManager.getWallet()

        const childLogger = this.logger.child({
            compressedUserOperations: compressedOps,
            entryPoint: entryPoint
        })
        childLogger.debug("bundling compressed user operation")

        const gasPriceParameters = await this.gasPriceManager.getGasPrice()
        childLogger.debug({ gasPriceParameters }, "got gas price")

        const nonce = await this.config.publicClient.getTransactionCount({
            address: wallet.address,
            blockTag: "pending"
        })
        childLogger.trace({ nonce }, "got nonce")

        const callContext: CompressedFilterOpsAndEstimateGasParams = {
            publicClient: this.config.publicClient,
            bundleBulker: compressionHandler.bundleBulkerAddress,
            perOpInflatorId: compressionHandler.perOpInflatorId,
            type: "compressed"
        }

        let { gasLimit, simulatedOps } = await filterOpsAndEstimateGas(
            entryPoint,
            callContext,
            wallet,
            compressedOps.map((compressedOp) => {
                return {
                    mempoolUserOperation: compressedOp,
                    userOperationHash: getUserOperationHash(
                        compressedOp.inflatedOp,
                        entryPoint,
                        this.config.walletClient.chain.id
                    )
                }
            }),
            nonce,
            gasPriceParameters.maxFeePerGas,
            gasPriceParameters.maxPriorityFeePerGas,
            this.config.blockTagSupport ? "pending" : undefined,
            this.config.legacyTransactions,
            this.config.fixedGasLimitForEstimation,
            this.reputationManager,
            childLogger
        )

        gasLimit += 10_000n

        if (simulatedOps.length === 0) {
            childLogger.warn("no ops to bundle")
            this.markWalletProcessed(wallet)
            return compressedOps.map((compressedOp) => {
                const userOpHash = getUserOperationHash(
                    compressedOp.inflatedOp,
                    entryPoint,
                    this.config.walletClient.chain.id
                )

                return {
                    status: "failure",
                    error: {
                        entryPoint,
                        userOpHash,
                        userOperation: compressedOp,
                        reason: "INTERNAL FAILURE"
                    }
                }
            })
        }

        // if not all succeeded, return error
        if (
            simulatedOps.some((simulatedOp) => simulatedOp.reason !== undefined)
        ) {
            childLogger.warn("some ops failed simulation")
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

        const opsToBundle: UserOperationWithHash[] = simulatedOps
            .filter((simulatedOp) => simulatedOp.reason === undefined)
            .map((simulatedOp) => simulatedOp.owh)

        let transactionHash: HexData32
        try {
            const gasOptions = this.config.legacyTransactions
                ? {
                      gasPrice: gasPriceParameters.maxFeePerGas
                  }
                : {
                      maxFeePerGas: gasPriceParameters.maxFeePerGas,
                      maxPriorityFeePerGas:
                          gasPriceParameters.maxPriorityFeePerGas
                  }

            const compressedOpsToBundle = opsToBundle.map(
                ({ mempoolUserOperation }) => {
                    const compressedOp = mempoolUserOperation
                    return compressedOp as CompressedUserOperation
                }
            )

            // need to use sendTransaction to target BundleBulker's fallback
            transactionHash = await this.config.walletClient.sendTransaction({
                account: wallet,
                to: compressionHandler.bundleBulkerAddress,
                data: createCompressedCalldata(
                    compressedOpsToBundle,
                    compressionHandler.perOpInflatorId
                ),
                gas: gasLimit,
                nonce: nonce,
                ...gasOptions
            })

            opsToBundle.map(({ userOperationHash }) => {
                this.eventManager.emitSubmitted(
                    userOperationHash,
                    transactionHash
                )
            })
        } catch (err: unknown) {
            sentry.captureException(err)
            childLogger.error(
                { error: JSON.stringify(err) },
                "error submitting bundle transaction"
            )
            this.markWalletProcessed(wallet)
            return opsToBundle.map(
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

        const userOperationInfos = opsToBundle.map((owh) => {
            return {
                entryPoint,
                mempoolUserOperation: owh.mempoolUserOperation,
                userOperationHash: owh.userOperationHash,
                lastReplaced: Date.now(),
                firstSubmitted: Date.now()
            }
        })

        const transactionInfo: TransactionInfo = {
            entryPoint,
            isVersion06: true, //TODO: compressed bundles are always v06
            transactionType: "compressed",
            transactionHash,
            previousTransactionHashes: [],
            transactionRequest: {
                to: compressionHandler.bundleBulkerAddress,
                data: createCompressedCalldata(
                    compressedOps,
                    compressionHandler.perOpInflatorId
                ),
                gas: gasLimit,
                account: wallet,
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
                txHash: transactionHash,
                opHashes: opsToBundle.map((owh) => owh.userOperationHash)
            },
            "submitted bundle transaction"
        )

        return userOperationResults
    }
}
