import type {
    DefaultFilterOpsAndEstimateGasParams,
    SenderManager
} from "@alto/executor"
import type { InterfaceReputationManager } from "@alto/mempool"
import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    deriveUserOperation,
    type Address,
    type BundleResult,
    type CompressedUserOperation,
    type HexData32,
    type TransactionInfo,
    type UserOperation,
    type UserOperationV06,
    type UserOperationV07,
    type UserOperationWithHash
} from "@alto/types"
import type { GasPriceManager, Logger, Metrics } from "@alto/utils"
import {
    getUserOperationHash,
    isVersion06,
    maxBigInt,
    parseViemError,
    toPackedUserOperation,
    type CompressionHandler
} from "@alto/utils"
import * as sentry from "@sentry/node"
import { Mutex } from "async-mutex"
import {
    FeeCapTooLowError,
    InsufficientFundsError,
    IntrinsicGasTooLowError,
    NonceTooLowError,
    encodeFunctionData,
    getContract,
    type Account,
    type Chain,
    type PublicClient,
    type Transport,
    type WalletClient
} from "viem"
import {
    createCompressedCalldata,
    filterOpsAndEstimateGas,
    flushStuckTransaction,
    simulatedOpsToResults,
    type CompressedFilterOpsAndEstimateGasParams
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

export class NullExecutor {
    bundle(
        _entryPoint: Address,
        _ops: UserOperation[]
    ): Promise<BundleResult[]> {
        return Promise.resolve([])
    }
    bundleCompressed(
        _entryPoint: Address,
        _compressedOps: CompressedUserOperation[]
    ): Promise<BundleResult[]> {
        return Promise.resolve([])
    }
    replaceTransaction(
        _entryPoint: Address,
        _transactionInfo: TransactionInfo
    ): Promise<ReplaceTransactionResult> {
        return Promise.resolve({ status: "failed" })
    }
    replaceOps(_opHashes: HexData32[]): Promise<void> {
        return Promise.resolve()
    }
    cancelOps(_entryPoint: Address, _ops: UserOperation[]): Promise<void> {
        return Promise.resolve()
    }
    markWalletProcessed(_executor: Account): Promise<void> {
        return Promise.resolve()
    }
    flushStuckTransactions(): Promise<void> {
        return Promise.resolve()
    }
}

export class Executor {
    // private unWatch: WatchBlocksReturnType | undefined

    publicClient: PublicClient
    walletClient: WalletClient<Transport, Chain, Account | undefined>
    entryPoints: Address[]
    senderManager: SenderManager
    logger: Logger
    metrics: Metrics
    simulateTransaction: boolean
    legacyTransactions: boolean
    fixedGasLimitForEstimation?: bigint
    localGasLimitCalculation: boolean
    reputationManager: InterfaceReputationManager
    compressionHandler: CompressionHandler | null
    gasPriceManager: GasPriceManager
    mutex: Mutex

    constructor(
        publicClient: PublicClient,
        walletClient: WalletClient<Transport, Chain, Account | undefined>,
        senderManager: SenderManager,
        reputationManager: InterfaceReputationManager,
        entryPoints: Address[],
        logger: Logger,
        metrics: Metrics,
        compressionHandler: CompressionHandler | null,
        gasPriceManager: GasPriceManager,
        simulateTransaction = false,
        legacyTransactions = false,
        fixedGasLimitForEstimation?: bigint,
        localGasLimitCalculation = false
    ) {
        this.publicClient = publicClient
        this.walletClient = walletClient
        this.senderManager = senderManager
        this.reputationManager = reputationManager
        this.logger = logger
        this.metrics = metrics
        this.simulateTransaction = simulateTransaction
        this.legacyTransactions = legacyTransactions
        this.fixedGasLimitForEstimation = fixedGasLimitForEstimation
        this.localGasLimitCalculation = localGasLimitCalculation
        this.compressionHandler = compressionHandler
        this.gasPriceManager = gasPriceManager
        this.entryPoints = entryPoints

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
                        this.walletClient.chain.id
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
                    public: this.publicClient,
                    wallet: this.walletClient
                }
            })

            callContext = {
                ep,
                type: "default"
            }
        } else {
            const compressionHandler = this.getCompressionHandler()

            callContext = {
                publicClient: this.publicClient,
                bundleBulker: compressionHandler.bundleBulkerAddress,
                perOpInflatorId: compressionHandler.perOpInflatorId,
                type: "compressed"
            }
        }

        const result = await filterOpsAndEstimateGas(
            transactionInfo.entryPoint,
            callContext,
            transactionInfo.executor,
            opsWithHashes,
            newRequest.nonce,
            newRequest.maxFeePerGas,
            newRequest.maxPriorityFeePerGas,
            "latest",
            this.legacyTransactions,
            this.fixedGasLimitForEstimation,
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

        newRequest.gas = this.localGasLimitCalculation
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

            const txHash = await this.walletClient.sendTransaction(
                this.legacyTransactions
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
        const gasPrice = await this.gasPriceManager.getGasPrice()

        const wallets = this.senderManager.utilityAccount
            ? Array.from(
                  new Set([
                      ...this.senderManager.wallets,
                      this.senderManager.utilityAccount
                  ])
              )
            : Array.from(new Set(this.senderManager.wallets))
        const promises = wallets.map(async (wallet) => {
            for (const entryPoint of this.entryPoints) {
                await flushStuckTransaction(
                    this.publicClient,
                    this.walletClient,
                    wallet,
                    gasPrice.maxFeePerGas * 5n,
                    this.logger,
                    entryPoint
                )
            }
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
                public: this.publicClient,
                wallet: this.walletClient
            }
        })

        let childLogger = this.logger.child({
            userOperations: opsWithHashes.map((oh) => oh.userOperationHash),
            entryPoint
        })
        childLogger.debug("bundling user operation")

        const gasPriceParameters = await this.gasPriceManager.getGasPrice()
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

        let { gasLimit, simulatedOps, resubmitAllOps } =
            await filterOpsAndEstimateGas(
                entryPoint,
                callContext,
                wallet,
                opsWithHashes,
                nonce,
                gasPriceParameters.maxFeePerGas,
                gasPriceParameters.maxPriorityFeePerGas,
                "pending",
                this.legacyTransactions,
                this.fixedGasLimitForEstimation,
                this.reputationManager,
                childLogger
            )

        gasLimit += 10_000n

        if (resubmitAllOps) {
            this.markWalletProcessed(wallet)
            return opsWithHashes.map((owh) => {
                const bundleResult: BundleResult = {
                    status: "resubmit",
                    info: {
                        entryPoint,
                        userOpHash: owh.userOperationHash,
                        userOperation: owh.mempoolUserOperation,
                        reason: FeeCapTooLowError.name
                    }
                }
                return bundleResult
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
                        entryPoint,
                        userOpHash: owh.userOperationHash,
                        userOperation: owh.mempoolUserOperation,
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
                        entryPoint,
                        userOpHash: op.owh.userOperationHash,
                        userOperation: op.owh.mempoolUserOperation,
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
            const gasOptions = this.legacyTransactions
                ? {
                      gasPrice: gasPriceParameters.maxFeePerGas
                  }
                : {
                      maxFeePerGas: gasPriceParameters.maxFeePerGas,
                      maxPriorityFeePerGas:
                          gasPriceParameters.maxPriorityFeePerGas
                  }
            txHash = isUserOpVersion06
                ? await ep.write.handleOps(
                      [
                          opsWithHashToBundle.map(
                              (owh) =>
                                  owh.mempoolUserOperation as UserOperationV06
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
                : await ep.write.handleOps(
                      [
                          opsWithHashToBundle.map((owh) =>
                              toPackedUserOperation(
                                  owh.mempoolUserOperation as UserOperationV07
                              )
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
            transactionType: "default",
            transactionHash: txHash,
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
            entryPoint: entryPoint
        })
        childLogger.debug("bundling compressed user operation")

        const gasPriceParameters = await this.gasPriceManager.getGasPrice()
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

        let { gasLimit, simulatedOps, resubmitAllOps } =
            await filterOpsAndEstimateGas(
                entryPoint,
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
                this.legacyTransactions,
                this.fixedGasLimitForEstimation,
                this.reputationManager,
                childLogger
            )

        gasLimit += 10_000n

        if (resubmitAllOps) {
            this.markWalletProcessed(wallet)
            return compressedOps.map((compressedOp) => {
                return {
                    status: "resubmit",
                    info: {
                        entryPoint,
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

        if (simulatedOps.length === 0) {
            childLogger.warn("no ops to bundle")
            this.markWalletProcessed(wallet)
            return compressedOps.map((compressedOp) => {
                return {
                    status: "failure",
                    error: {
                        entryPoint,
                        userOpHash: getUserOperationHash(
                            compressedOp.inflatedOp,
                            entryPoint,
                            this.walletClient.chain.id
                        ),
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
            return simulatedOps.map((simulatedOp) => {
                return {
                    status: "failure",
                    error: {
                        entryPoint,
                        userOpHash: simulatedOp.owh.userOperationHash,
                        userOperation: simulatedOp.owh.mempoolUserOperation,
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
            const gasOptions = this.legacyTransactions
                ? {
                      gasPrice: gasPriceParameters.maxFeePerGas
                  }
                : {
                      maxFeePerGas: gasPriceParameters.maxFeePerGas,
                      maxPriorityFeePerGas:
                          gasPriceParameters.maxPriorityFeePerGas
                  }

            // need to use sendTransaction to target BundleBulker's fallback
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
                        entryPoint,
                        userOpHash: op.userOperationHash,
                        userOperation: op.mempoolUserOperation,
                        reason: "INTERNAL FAILURE"
                    }
                }
            })
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
