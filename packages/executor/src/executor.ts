import type { IReputationManager } from "@alto/mempool"
import {
    type Address,
    type BundleResult,
    type CompressedUserOperation,
    EntryPointAbi,
    type HexData32,
    type TransactionInfo,
    type UserOperation,
    type UserOperationWithHash,
    deriveUserOperation
} from "@alto/types"
import {
    type CompressionHandler,
    type Logger,
    type Metrics,
    getGasPrice,
    getUserOperationHash,
    maxBigInt,
    parseViemError
} from "@alto/utils"
import * as sentry from "@sentry/node"
import { Mutex } from "async-mutex"
import {
    type Account,
    type Chain,
    FeeCapTooLowError,
    InsufficientFundsError,
    IntrinsicGasTooLowError,
    NonceTooLowError,
    type PublicClient,
    type Transport,
    type WalletClient,
    encodeFunctionData,
    getContract
} from "viem"
import type { SenderManager } from "./senderManager"
import {
    type CompressedFilterOpsAndEstimateGasParams,
    type DefaultFilterOpsAndEstimateGasParams,
    createCompressedCalldata,
    filterOpsAndEstimateGas,
    flushStuckTransaction,
    simulatedOpsToResults
} from "./utils"

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

export interface IExecutor {
    bundle(entryPoint: Address, ops: UserOperation[]): Promise<BundleResult[]>
    bundleCompressed(
        entryPoint: Address,
        compressedOps: CompressedUserOperation[]
    ): Promise<BundleResult[]>
    replaceTransaction(
        transactionInfo: TransactionInfo
    ): Promise<ReplaceTransactionResult>
    cancelOps(entryPoint: Address, ops: UserOperation[]): Promise<void>
    markWalletProcessed(executor: Account): Promise<void>
    flushStuckTransactions(): Promise<void>
}

export class NullExecutor implements IExecutor {
    async bundle(
        entryPoint: Address,
        ops: UserOperation[]
    ): Promise<BundleResult[]> {
        return []
    }
    async bundleCompressed(
        entryPoint: Address,
        compressedOps: CompressedUserOperation[]
    ): Promise<BundleResult[]> {
        return []
    }
    async replaceTransaction(
        transactionInfo: TransactionInfo
    ): Promise<ReplaceTransactionResult> {
        return { status: "failed" }
    }
    async replaceOps(opHahes: HexData32[]): Promise<void> {}
    async cancelOps(entryPoint: Address, ops: UserOperation[]): Promise<void> {}
    async markWalletProcessed(executor: Account): Promise<void> {}
    async flushStuckTransactions(): Promise<void> {}
}

export class BasicExecutor implements IExecutor {
    // private unWatch: WatchBlocksReturnType | undefined

    publicClient: PublicClient
    walletClient: WalletClient<Transport, Chain, Account | undefined>
    senderManager: SenderManager
    entryPoint: Address
    logger: Logger
    metrics: Metrics
    simulateTransaction: boolean
    noEip1559Support: boolean
    customGasLimitForEstimation?: bigint
    useUserOperationGasLimitsForSubmission: boolean
    reputationManager: IReputationManager
    compressionHandler: CompressionHandler | null

    mutex: Mutex

    constructor(
        publicClient: PublicClient,
        walletClient: WalletClient<Transport, Chain, Account | undefined>,
        senderManager: SenderManager,
        reputationManager: IReputationManager,
        entryPoint: Address,
        logger: Logger,
        metrics: Metrics,
        compressionHandler: CompressionHandler | null,
        simulateTransaction = false,
        noEip1559Support = false,
        customGasLimitForEstimation?: bigint,
        useUserOperationGasLimitsForSubmission = false
    ) {
        this.publicClient = publicClient
        this.walletClient = walletClient
        this.senderManager = senderManager
        this.reputationManager = reputationManager
        this.entryPoint = entryPoint
        this.logger = logger
        this.metrics = metrics
        this.simulateTransaction = simulateTransaction
        this.noEip1559Support = noEip1559Support
        this.customGasLimitForEstimation = customGasLimitForEstimation
        this.useUserOperationGasLimitsForSubmission =
            useUserOperationGasLimitsForSubmission
        this.compressionHandler = compressionHandler

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

    async markWalletProcessed(executor: Account) {
        if (!this.senderManager.availableWallets.includes(executor)) {
            this.senderManager.pushWallet(executor)
        }
    }

    async replaceTransaction(
        transactionInfo: TransactionInfo
    ): Promise<ReplaceTransactionResult> {
        const newRequest = { ...transactionInfo.transactionRequest }

        const gasPriceParameters = await getGasPrice(
            this.walletClient.chain,
            this.publicClient,
            this.noEip1559Support,
            this.logger
        )

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
                        this.entryPoint,
                        this.walletClient.chain.id
                    )
                }
            }
        )

        let callContext:
            | DefaultFilterOpsAndEstimateGasParams
            | CompressedFilterOpsAndEstimateGasParams

        if (transactionInfo.transactionType === "default") {
            const ep = getContract({
                abi: EntryPointAbi,
                address: this.entryPoint,
                publicClient: this.publicClient,
                walletClient: this.walletClient
            })

            callContext = {
                ep,
                type: "default"
            } as DefaultFilterOpsAndEstimateGasParams
        } else {
            const compressionHandler = this.getCompressionHandler()

            callContext = {
                publicClient: this.publicClient,
                bundleBulker: compressionHandler.bundleBulkerAddress,
                perOpInflatorId: compressionHandler.perOpInflatorId,
                type: "compressed"
            } as CompressedFilterOpsAndEstimateGasParams
        }

        const result = await filterOpsAndEstimateGas(
            callContext,
            transactionInfo.executor,
            opsWithHashes,
            newRequest.nonce,
            newRequest.maxFeePerGas,
            newRequest.maxPriorityFeePerGas,
            "latest",
            this.noEip1559Support,
            this.customGasLimitForEstimation,
            this.reputationManager,
            this.logger
        )

        const childLogger = this.logger.child({
            transactionHash: transactionInfo.transactionHash,
            executor: transactionInfo.executor.address
        })

        if (result.simulatedOps.length === 0) {
            childLogger.warn("no ops to bundle")
            this.markWalletProcessed(transactionInfo.executor)
            return { status: "failed" }
        }

        if (
            result.simulatedOps.every(
                (op) =>
                    op.reason === "AA25 invalid account nonce" ||
                    op.reason === "AA10 sender already constructed"
            )
        ) {
            childLogger.trace(
                { reasons: result.simulatedOps.map((sop) => sop.reason) },
                "all ops failed simulation with nonce error"
            )
            return { status: "potentially_already_included" }
        }

        if (result.simulatedOps.every((op) => op.reason !== undefined)) {
            childLogger.warn("all ops failed simulation")
            this.markWalletProcessed(transactionInfo.executor)
            return { status: "failed" }
        }

        const opsToBundle = result.simulatedOps
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

        newRequest.gas = this.useUserOperationGasLimitsForSubmission
            ? opsToBundle.reduce((acc, opInfo) => {
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
            : result.gasLimit

        // update calldata to include only ops that pass simulation
        if (transactionInfo.transactionType === "default") {
            newRequest.data = encodeFunctionData({
                abi: EntryPointAbi,
                functionName: "handleOps",
                args: [
                    opsToBundle.map(
                        (opInfo) => opInfo.mempoolUserOperation as UserOperation
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

            const txHash = await this.walletClient.sendTransaction(
                this.noEip1559Support
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

            const newTxInfo = {
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
                        mempoolUserOperation: opInfo.mempoolUserOperation,
                        userOperationHash: opInfo.userOperationHash,
                        lastReplaced: Date.now(),
                        firstSubmitted: opInfo.firstSubmitted
                    }
                })
            }

            return { status: "replaced", transactionInfo: newTxInfo }
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
        const gasPrice = await getGasPrice(
            this.walletClient.chain,
            this.publicClient,
            this.noEip1559Support,
            this.logger
        )

        const wallets = Array.from(
            new Set([
                ...this.senderManager.wallets,
                this.senderManager.utilityAccount
            ])
        )
        // biome-ignore lint/nursery/useAwait: <explanation>
        const promises = wallets.map(async (wallet) => {
            return flushStuckTransaction(
                this.publicClient,
                this.walletClient,
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
                    this.walletClient.chain.id
                )
            }
        })

        const ep = getContract({
            abi: EntryPointAbi,
            address: entryPoint,
            publicClient: this.publicClient,
            walletClient: this.walletClient
        })

        let childLogger = this.logger.child({
            userOperations: opsWithHashes.map((oh) => oh.userOperationHash),
            entryPoint
        })
        childLogger.debug("bundling user operation")

        const gasPriceParameters = await getGasPrice(
            this.walletClient.chain,
            this.publicClient,
            this.noEip1559Support,
            this.logger
        )
        childLogger.debug({ gasPriceParameters }, "got gas price")

        const nonce = await this.publicClient.getTransactionCount({
            address: wallet.address,
            blockTag: "pending"
        })
        childLogger.trace({ nonce }, "got nonce")

        const callContext: DefaultFilterOpsAndEstimateGasParams = {
            ep,
            type: "default"
        }

        const { gasLimit, simulatedOps } = await filterOpsAndEstimateGas(
            callContext,
            wallet,
            opsWithHashes,
            nonce,
            gasPriceParameters.maxFeePerGas,
            gasPriceParameters.maxPriorityFeePerGas,
            "pending",
            this.noEip1559Support,
            this.customGasLimitForEstimation,
            this.reputationManager,
            childLogger
        )

        if (
            simulatedOps.every((sop) => sop.reason === FeeCapTooLowError.name)
        ) {
            this.markWalletProcessed(wallet)
            return opsWithHashes.map((owh) => {
                return {
                    status: "resubmit",
                    info: {
                        userOpHash: owh.userOperationHash,
                        userOperation: owh.mempoolUserOperation,
                        reason: FeeCapTooLowError.name
                    }
                }
            })
        }

        if (simulatedOps.length === 0) {
            childLogger.error(
                "gas limit simulation encountered unexpected failure"
            )
            this.markWalletProcessed(wallet)
            return opsWithHashes.map((owh) => {
                return {
                    status: "failure",
                    error: {
                        userOpHash: owh.userOperationHash,
                        reason: "INTERNAL FAILURE"
                    }
                }
            })
        }

        if (simulatedOps.every((op) => op.reason !== undefined)) {
            childLogger.warn("all ops failed simulation")
            this.markWalletProcessed(wallet)
            return simulatedOps.map((op) => {
                return {
                    status: "failure",
                    error: {
                        userOpHash: op.owh.userOperationHash,
                        reason: op.reason as string
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

        childLogger.trace({ gasLimit }, "got gas limit")

        let txHash: HexData32
        try {
            const gasOptions = this.noEip1559Support
                ? {
                      gasPrice: gasPriceParameters.maxFeePerGas
                  }
                : {
                      maxFeePerGas: gasPriceParameters.maxFeePerGas,
                      maxPriorityFeePerGas:
                          gasPriceParameters.maxPriorityFeePerGas
                  }
            txHash = await ep.write.handleOps(
                [
                    opsWithHashToBundle.map(
                        (owh) => owh.mempoolUserOperation as UserOperation
                    ),
                    wallet.address
                ],
                {
                    account: wallet,
                    gas: gasLimit,
                    nonce: nonce,
                    ...gasOptions
                }
            )
        } catch (err: unknown) {
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
                        userOpHash: owh.userOperationHash,
                        reason: "INTERNAL FAILURE"
                    }
                }
            })
        }

        const userOperationInfos = opsWithHashToBundle.map((op) => {
            return {
                mempoolUserOperation: op.mempoolUserOperation,
                userOperationHash: op.userOperationHash,
                lastReplaced: Date.now(),
                firstSubmitted: Date.now()
            }
        })

        const transactionInfo: TransactionInfo = {
            transactionType: "default",
            transactionHash: txHash,
            previousTransactionHashes: [],
            transactionRequest: {
                account: wallet,
                to: ep.address,
                data: encodeFunctionData({
                    abi: ep.abi,
                    functionName: "handleOps",
                    args: [
                        opsWithHashToBundle.map(
                            (owh) => owh.mempoolUserOperation as UserOperation
                        ),
                        wallet.address
                    ]
                }),
                gas: gasLimit,
                chain: this.walletClient.chain,
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
                txHash,
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
            entryPoint: this.entryPoint
        })
        childLogger.debug("bundling compressed user operation")

        const gasPriceParameters = await getGasPrice(
            this.walletClient.chain,
            this.publicClient,
            this.noEip1559Support,
            this.logger
        )
        childLogger.debug({ gasPriceParameters }, "got gas price")

        const nonce = await this.publicClient.getTransactionCount({
            address: wallet.address,
            blockTag: "pending"
        })
        childLogger.trace({ nonce }, "got nonce")

        const callContext: CompressedFilterOpsAndEstimateGasParams = {
            publicClient: this.publicClient,
            bundleBulker: compressionHandler.bundleBulkerAddress,
            perOpInflatorId: compressionHandler.perOpInflatorId,
            type: "compressed"
        }

        let { gasLimit, simulatedOps } = await filterOpsAndEstimateGas(
            callContext,
            wallet,
            compressedOps.map((compressedOp) => {
                return {
                    mempoolUserOperation: compressedOp,
                    userOperationHash: getUserOperationHash(
                        compressedOp.inflatedOp,
                        entryPoint,
                        this.walletClient.chain.id
                    )
                }
            }),
            nonce,
            gasPriceParameters.maxFeePerGas,
            gasPriceParameters.maxPriorityFeePerGas,
            "pending",
            this.noEip1559Support,
            this.customGasLimitForEstimation,
            this.reputationManager,
            childLogger
        )

        if (
            simulatedOps.every((sop) => sop.reason === FeeCapTooLowError.name)
        ) {
            this.markWalletProcessed(wallet)
            return compressedOps.map((compressedOp) => {
                return {
                    status: "resubmit",
                    info: {
                        userOpHash: getUserOperationHash(
                            compressedOp.inflatedOp,
                            entryPoint,
                            this.walletClient.chain.id
                        ),
                        userOperation: compressedOp,
                        reason: FeeCapTooLowError.name
                    }
                }
            })
        }

        gasLimit += 10_000n

        if (simulatedOps.length === 0) {
            childLogger.warn("no ops to bundle")
            this.markWalletProcessed(wallet)
            return compressedOps.map((compressedOp) => {
                return {
                    status: "failure",
                    error: {
                        userOpHash: getUserOperationHash(
                            compressedOp.inflatedOp,
                            entryPoint,
                            this.walletClient.chain.id
                        ),
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
            return simulatedOps.map((simulatedOp) => {
                return {
                    status: "failure",
                    error: {
                        userOpHash: simulatedOp.owh.userOperationHash,
                        reason: simulatedOp.reason as string
                    }
                }
            })
        }

        const opsToBundle: UserOperationWithHash[] = simulatedOps
            .filter((simulatedOp) => simulatedOp.reason === undefined)
            .map((simulatedOp) => simulatedOp.owh)

        let txHash: HexData32
        try {
            const gasOptions = this.noEip1559Support
                ? {
                      gasPrice: gasPriceParameters.maxFeePerGas
                  }
                : {
                      maxFeePerGas: gasPriceParameters.maxFeePerGas,
                      maxPriorityFeePerGas:
                          gasPriceParameters.maxPriorityFeePerGas
                  }

            // need to use sendTransction to target BundleBulker's fallback
            txHash = await this.walletClient.sendTransaction({
                account: wallet,
                to: compressionHandler.bundleBulkerAddress,
                data: createCompressedCalldata(
                    compressedOps,
                    compressionHandler.perOpInflatorId
                ),
                gas: gasLimit,
                nonce: nonce,
                ...gasOptions
            })
        } catch (err: unknown) {
            sentry.captureException(err)
            childLogger.error(
                { error: JSON.stringify(err) },
                "error submitting bundle transaction"
            )
            this.markWalletProcessed(wallet)
            return opsToBundle.map((op) => {
                return {
                    status: "failure",
                    error: {
                        userOpHash: op.userOperationHash,
                        reason: "INTERNAL FAILURE"
                    }
                }
            })
        }

        const userOperationInfos = opsToBundle.map((owh) => {
            return {
                mempoolUserOperation: owh.mempoolUserOperation,
                userOperationHash: owh.userOperationHash,
                lastReplaced: Date.now(),
                firstSubmitted: Date.now()
            }
        })

        const transactionInfo: TransactionInfo = {
            transactionType: "compressed",
            transactionHash: txHash,
            previousTransactionHashes: [],
            transactionRequest: {
                to: compressionHandler.bundleBulkerAddress,
                data: createCompressedCalldata(
                    compressedOps,
                    compressionHandler.perOpInflatorId
                ),
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
            firstSubmitted: Date.now(),
            timesPotentiallyIncluded: 0
        }

        const userOperationResults: BundleResult[] = simulatedOpsToResults(
            simulatedOps,
            transactionInfo
        )

        childLogger.info(
            {
                txHash,
                opHashes: opsToBundle.map((owh) => owh.userOperationHash)
            },
            "submitted bundle transaction"
        )

        return userOperationResults
    }
}
