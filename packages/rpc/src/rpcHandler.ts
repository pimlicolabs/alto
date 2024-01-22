import { IExecutor, ExecutorManager } from "@alto/executor"
import { IReputationManager, Mempool, Monitor } from "@alto/mempool"
import {
    Address,
    BundlerClearMempoolResponseResult,
    BundlerClearStateResponseResult,
    BundlerDumpMempoolResponseResult,
    BundlerDumpReputationsResponseResult,
    BundlerGetStakeStatusResponseResult,
    BundlerRequest,
    BundlerResponse,
    BundlerSendBundleNowResponseResult,
    BundlerSetBundlingModeResponseResult,
    BundlerSetReputationsRequestParams,
    BundlingMode,
    ChainIdResponseResult,
    EntryPointAbi,
    Environment,
    EstimateUserOperationGasResponseResult,
    GetUserOperationByHashResponseResult,
    GetUserOperationReceiptResponseResult,
    HexData32,
    IValidator,
    PimlicoGetUserOperationGasPriceResponseResult,
    PimlicoGetUserOperationStatusResponseResult,
    RpcError,
    SendUserOperationResponseResult,
    SupportedEntryPointsResponseResult, UserOperation,
    logSchema,
    receiptSchema,
    ValidationErrors,
    bundlerGetStakeStatusResponseSchema,
    MempoolUserOperation,
    CompressedUserOperation,
    deriveUserOperation,
    IOpInflatorAbi,
} from "@alto/types"
import {
    Logger,
    Metrics,
    calcArbitrumPreVerificationGas,
    calcOptimismPreVerificationGas,
    calcPreVerificationGas,
    getGasPrice,
    getNonceKeyAndValue,
    getUserOperationHash,
    CompressionHandler
} from "@alto/utils"
import {
    Chain,
    Hex,
    PublicClient,
    Transaction,
    TransactionNotFoundError,
    TransactionReceipt,
    TransactionReceiptNotFoundError,
    Transport,
    decodeFunctionData,
    getAbiItem,
    getContract
} from "viem"
import * as chains from "viem/chains"
import { z } from "zod"
import { fromZodError } from "zod-validation-error"
import {
    estimateCallGasLimit,
    estimateVerificationGasLimit
} from "./gasEstimation"
import { NonceQueuer } from "./nonceQueuer"
import { StateOverrides } from "@alto/types"

export interface IRpcEndpoint {
    handleMethod(request: BundlerRequest): Promise<BundlerResponse>
    eth_chainId(): Promise<ChainIdResponseResult>
    eth_supportedEntryPoints(): Promise<SupportedEntryPointsResponseResult>
    eth_estimateUserOperationGas(
        userOperation: UserOperation,
        entryPoint: Address,
        stateOverrides?: StateOverrides
    ): Promise<EstimateUserOperationGasResponseResult>
    eth_sendUserOperation(
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<SendUserOperationResponseResult>
    eth_getUserOperationByHash(
        userOperationHash: HexData32
    ): Promise<GetUserOperationByHashResponseResult>
    eth_getUserOperationReceipt(
        userOperationHash: HexData32
    ): Promise<GetUserOperationReceiptResponseResult>
}

export class RpcHandler implements IRpcEndpoint {
    entryPoint: Address
    publicClient: PublicClient<Transport, Chain>
    validator: IValidator
    mempool: Mempool
    executor: IExecutor
    monitor: Monitor
    nonceQueuer: NonceQueuer
    usingTenderly: boolean
    minimumGasPricePercent: number
    noEthCallOverrideSupport: boolean
    rpcMaxBlockRange: number | undefined
    logger: Logger
    metrics: Metrics
    chainId: number
    environment: Environment
    executorManager: ExecutorManager
    reputationManager: IReputationManager
    compressionHandler: CompressionHandler | null

    constructor(
        entryPoint: Address,
        publicClient: PublicClient<Transport, Chain>,
        validator: IValidator,
        mempool: Mempool,
        executor: IExecutor,
        monitor: Monitor,
        nonceQueuer: NonceQueuer,
        executorManager: ExecutorManager,
        reputationManager: IReputationManager,
        usingTenderly: boolean,
        minimumGasPricePercent: number,
        noEthCallOverrideSupport: boolean,
        rpcMaxBlockRange: number | undefined,
        logger: Logger,
        metrics: Metrics,
        environment: Environment,
        compressionHandler: CompressionHandler | null
    ) {
        this.entryPoint = entryPoint
        this.publicClient = publicClient
        this.validator = validator
        this.mempool = mempool
        this.executor = executor
        this.monitor = monitor
        this.nonceQueuer = nonceQueuer
        this.usingTenderly = usingTenderly
        this.minimumGasPricePercent = minimumGasPricePercent
        this.noEthCallOverrideSupport = noEthCallOverrideSupport
        this.rpcMaxBlockRange = rpcMaxBlockRange
        this.logger = logger
        this.metrics = metrics
        this.environment = environment
        this.chainId = publicClient.chain.id
        this.executorManager = executorManager
        this.reputationManager = reputationManager
        this.compressionHandler = compressionHandler
    }

    async handleMethod(request: BundlerRequest): Promise<BundlerResponse> {
        // call the method with the params
        const method = request.method
        switch (method) {
            case "eth_chainId":
                return {
                    method,
                    result: await this.eth_chainId(...request.params)
                }
            case "eth_supportedEntryPoints":
                return {
                    method,
                    result: await this.eth_supportedEntryPoints(
                        ...request.params
                    )
                }
            case "eth_estimateUserOperationGas":
                return {
                    method,
                    result: await this.eth_estimateUserOperationGas(
                        request.params[0],
                        request.params[1],
                        request.params[2]
                    )
                }
            case "eth_sendUserOperation":
                return {
                    method,
                    result: await this.eth_sendUserOperation(...request.params)
                }
            case "eth_getUserOperationByHash":
                return {
                    method,
                    result: await this.eth_getUserOperationByHash(
                        ...request.params
                    )
                }
            case "eth_getUserOperationReceipt":
                return {
                    method,
                    result: await this.eth_getUserOperationReceipt(
                        ...request.params
                    )
                }
            case "debug_bundler_clearMempool":
                return {
                    method,
                    result: await this.debug_bundler_clearMempool(
                        ...request.params
                    )
                }
            case "debug_bundler_clearState":
                return {
                    method,
                    result: await this.debug_bundler_clearState(
                        ...request.params
                    )
                }
            case "debug_bundler_dumpMempool":
                return {
                    method,
                    result: await this.debug_bundler_dumpMempool(
                        ...request.params
                    )
                }
            case "debug_bundler_sendBundleNow":
                return {
                    method,
                    result: await this.debug_bundler_sendBundleNow(
                        ...request.params
                    )
                }
            case "debug_bundler_setBundlingMode":
                return {
                    method,
                    result: await this.debug_bundler_setBundlingMode(
                        ...request.params
                    )
                }
            case "debug_bundler_setReputation":
                return {
                    method,
                    result: await this.debug_bundler_setReputation(
                        request.params
                    )
                }
            case "debug_bundler_dumpReputation":
                return {
                    method,
                    result: await this.debug_bundler_dumpReputation(
                        ...request.params
                    )
                }
            case "debug_bundler_getStakeStatus":
                return {
                    method,
                    result: await this.debug_bundler_getStakeStatus(
                        ...request.params
                    )
                }
            case "pimlico_getUserOperationStatus":
                return {
                    method,
                    result: await this.pimlico_getUserOperationStatus(
                        ...request.params
                    )
                }
            case "pimlico_getUserOperationGasPrice":
                return {
                    method,
                    result: await this.pimlico_getUserOperationGasPrice(
                        ...request.params
                    )
                }
            case "pimlico_sendCompressedUserOperation":
                return {
                    method,
                    result: await this.pimlico_sendCompressedUserOperation(...request.params)
                }
        }
    }

    async eth_chainId(): Promise<ChainIdResponseResult> {
        return BigInt(this.chainId)
    }

    async eth_supportedEntryPoints(): Promise<SupportedEntryPointsResponseResult> {
        return [this.entryPoint]
    }

    async eth_estimateUserOperationGas(
        userOperation: UserOperation,
        entryPoint: Address,
        stateOverrides?: StateOverrides
    ): Promise<EstimateUserOperationGasResponseResult> {
        // check if entryPoint is supported, if not throw
        if (this.entryPoint !== entryPoint) {
            throw new Error(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.entryPoint}`
            )
        }

        if (userOperation.maxFeePerGas === 0n) {
            throw new RpcError(
                "user operation max fee per gas must be larger than 0 during gas estimation"
            )
        }
        let preVerificationGas = calcPreVerificationGas(userOperation)

        if (this.chainId === 59140 || this.chainId === 59142) {
            preVerificationGas *= 2n
        } else if (
            this.chainId === chains.optimism.id ||
            this.chainId === chains.optimismGoerli.id ||
            this.chainId === chains.base.id ||
            this.chainId === chains.baseGoerli.id ||
            this.chainId === chains.opBNB.id ||
            this.chainId === chains.opBNBTestnet.id
        ) {
            preVerificationGas = await calcOptimismPreVerificationGas(
                this.publicClient,
                userOperation,
                entryPoint,
                preVerificationGas,
                this.logger
            )
        } else if (this.chainId === chains.arbitrum.id) {
            preVerificationGas = await calcArbitrumPreVerificationGas(
                this.publicClient,
                userOperation,
                entryPoint,
                preVerificationGas
            )
        }

        let verificationGasLimit: bigint
        let callGasLimit: bigint

        if (this.noEthCallOverrideSupport) {
            userOperation.preVerificationGas = 1_000_000n
            userOperation.verificationGasLimit = 10_000_000n
            userOperation.callGasLimit = 10_000_000n

            if (
                this.chainId === 8453 ||
                this.chainId === chains.celoAlfajores.id ||
                this.chainId === chains.celo.id
            ) {
                userOperation.verificationGasLimit = 1_000_000n
                userOperation.callGasLimit = 1_000_000n
            }

            const executionResult = await this.validator.getExecutionResult(
                userOperation,
                stateOverrides
            )

            verificationGasLimit =
                ((executionResult.preOpGas - userOperation.preVerificationGas) *
                    3n) /
                2n

            let gasPrice: bigint

            if (
                userOperation.maxPriorityFeePerGas ===
                userOperation.maxFeePerGas
            ) {
                gasPrice = userOperation.maxFeePerGas
            } else {
                const blockBaseFee = (await this.publicClient.getBlock())
                    .baseFeePerGas
                gasPrice =
                    userOperation.maxFeePerGas <
                        (blockBaseFee ?? 0n) + userOperation.maxPriorityFeePerGas
                        ? userOperation.maxFeePerGas
                        : userOperation.maxPriorityFeePerGas +
                        (blockBaseFee ?? 0n)
            }
            const calculatedCallGasLimit =
                executionResult.paid / gasPrice -
                executionResult.preOpGas +
                21000n +
                50000n

            callGasLimit =
                calculatedCallGasLimit > 9000n ? calculatedCallGasLimit : 9000n

            if (
                this.chainId === chains.baseGoerli.id ||
                this.chainId === chains.base.id
            ) {
                callGasLimit = (110n * callGasLimit) / 100n
            }
        } else {
            userOperation.maxFeePerGas = 0n
            userOperation.maxPriorityFeePerGas = 0n

            const time = Date.now()

            verificationGasLimit = await estimateVerificationGasLimit(
                userOperation,
                entryPoint,
                this.publicClient,
                this.logger,
                this.metrics,
                stateOverrides
            )

            userOperation.preVerificationGas = preVerificationGas
            userOperation.verificationGasLimit = verificationGasLimit

            this.metrics.verificationGasLimitEstimationTime.observe(
                (Date.now() - time) / 1000
            )

            callGasLimit = await estimateCallGasLimit(
                userOperation,
                entryPoint,
                this.publicClient,
                this.logger,
                this.metrics,
                stateOverrides
            )
        }

        return {
            preVerificationGas,
            verificationGas: verificationGasLimit,
            verificationGasLimit,
            callGasLimit
        }
    }

    async eth_sendUserOperation(
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<SendUserOperationResponseResult> {
        await this.addToMempoolIfValid(userOperation, entryPoint)

        const hash = getUserOperationHash(
            userOperation,
            entryPoint,
            this.chainId
        )
        return hash
    }

    async eth_getUserOperationByHash(
        userOperationHash: HexData32
    ): Promise<GetUserOperationByHashResponseResult> {
        const userOperationEventAbiItem = getAbiItem({
            abi: EntryPointAbi,
            name: "UserOperationEvent"
        })

        let fromBlock: bigint | undefined = undefined
        let toBlock: "latest" | undefined = undefined
        if (this.rpcMaxBlockRange !== undefined) {
            const latestBlock = await this.publicClient.getBlockNumber()
            fromBlock = latestBlock - BigInt(this.rpcMaxBlockRange)
            if (fromBlock < 0n) {
                fromBlock = 0n
            }
            toBlock = "latest"
        }

        const filterResult = await this.publicClient.getLogs({
            address: this.entryPoint,
            event: userOperationEventAbiItem,
            fromBlock,
            toBlock,
            args: {
                userOpHash: userOperationHash
            }
        })

        if (filterResult.length === 0) {
            return null
        }

        const userOperationEvent = filterResult[0]
        const txHash = userOperationEvent.transactionHash
        if (txHash === null) {
            // transaction pending
            return null
        }

        const getTransaction = async (
            txHash: HexData32
        ): Promise<Transaction> => {
            try {
                return await this.publicClient.getTransaction({ hash: txHash })
            } catch (e) {
                if (e instanceof TransactionNotFoundError) {
                    return getTransaction(txHash)
                }

                throw e
            }
        }

        const tx = await getTransaction(txHash)
        let op: any = undefined
        try {
            const decoded = decodeFunctionData({
                abi: EntryPointAbi,
                data: tx.input
            })
            if (decoded.functionName !== "handleOps") {
                return null
            }
            const ops = decoded.args[0]
            op = ops.find(
                (op: UserOperation) =>
                    op.sender === userOperationEvent.args.sender &&
                    op.nonce === userOperationEvent.args.nonce
            )
        } catch {
            return null
        }

        if (op === undefined) {
            return null
        }

        const result: GetUserOperationByHashResponseResult = {
            userOperation: op,
            entryPoint: this.entryPoint,
            transactionHash: txHash,
            blockHash: tx.blockHash ?? "0x",
            blockNumber: BigInt(tx.blockNumber ?? 0n)
        }

        return result
    }

    async eth_getUserOperationReceipt(
        userOperationHash: HexData32
    ): Promise<GetUserOperationReceiptResponseResult> {
        const userOperationEventAbiItem = getAbiItem({
            abi: EntryPointAbi,
            name: "UserOperationEvent"
        })

        let fromBlock: bigint | undefined = undefined
        let toBlock: "latest" | undefined = undefined
        if (this.rpcMaxBlockRange !== undefined) {
            const latestBlock = await this.publicClient.getBlockNumber()
            fromBlock = latestBlock - BigInt(this.rpcMaxBlockRange)
            if (fromBlock < 0n) {
                fromBlock = 0n
            }
            toBlock = "latest"
        }

        const filterResult = await this.publicClient.getLogs({
            address: this.entryPoint,
            event: userOperationEventAbiItem,
            fromBlock,
            toBlock,
            args: {
                userOpHash: userOperationHash
            }
        })

        if (filterResult.length === 0) {
            return null
        }

        const userOperationEvent = filterResult[0]
        // throw if any of the members of userOperationEvent are undefined
        if (
            userOperationEvent.args.actualGasCost === undefined ||
            userOperationEvent.args.sender === undefined ||
            userOperationEvent.args.nonce === undefined ||
            userOperationEvent.args.userOpHash === undefined ||
            userOperationEvent.args.success === undefined ||
            userOperationEvent.args.paymaster === undefined ||
            userOperationEvent.args.actualGasUsed === undefined
        ) {
            throw new Error("userOperationEvent has undefined members")
        }

        const txHash = userOperationEvent.transactionHash
        if (txHash === null) {
            // transaction pending
            return null
        }

        const getTransactionReceipt = async (
            txHash: HexData32
        ): Promise<TransactionReceipt> => {
            try {
                return await this.publicClient.getTransactionReceipt({
                    hash: txHash
                })
            } catch (e) {
                if (e instanceof TransactionReceiptNotFoundError) {
                    return getTransactionReceipt(txHash)
                }

                throw e
            }
        }

        const receipt = await getTransactionReceipt(txHash)
        const logs = receipt.logs

        if (
            logs.some(
                (log) =>
                    log.blockHash === null ||
                    log.blockNumber === null ||
                    log.transactionIndex === null ||
                    log.transactionHash === null ||
                    log.logIndex === null ||
                    log.topics.length === 0
            )
        ) {
            // transaction pending
            return null
        }

        let startIndex = -1
        let endIndex = -1
        logs.forEach((log, index) => {
            if (log?.topics[0] === userOperationEvent.topics[0]) {
                // process UserOperationEvent
                if (log.topics[1] === userOperationEvent.topics[1]) {
                    // it's our userOpHash. save as end of logs array
                    endIndex = index
                } else {
                    // it's a different hash. remember it as beginning index, but only if we didn't find our end index yet.
                    if (endIndex === -1) {
                        startIndex = index
                    }
                }
            }
        })
        if (endIndex === -1) {
            throw new Error("fatal: no UserOperationEvent in logs")
        }

        const filteredLogs = logs.slice(startIndex + 1, endIndex)

        const logsParsing = z.array(logSchema).safeParse(filteredLogs)
        if (!logsParsing.success) {
            const err = fromZodError(logsParsing.error)
            throw err
        }

        const receiptParsing = receiptSchema.safeParse({
            ...receipt,
            status: receipt.status === "success" ? 1 : 0
        })
        if (!receiptParsing.success) {
            const err = fromZodError(receiptParsing.error)
            throw err
        }

        const userOperationReceipt: GetUserOperationReceiptResponseResult = {
            userOpHash: userOperationHash,
            sender: userOperationEvent.args.sender,
            nonce: userOperationEvent.args.nonce,
            actualGasUsed: userOperationEvent.args.actualGasUsed,
            actualGasCost: userOperationEvent.args.actualGasCost,
            success: userOperationEvent.args.success,
            logs: logsParsing.data,
            receipt: receiptParsing.data
        }

        return userOperationReceipt
    }

    async debug_bundler_clearState(): Promise<BundlerClearStateResponseResult> {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_clearState is only available in development environment"
            )
        }
        this.mempool.clear()
        this.reputationManager.clear()
        return "ok"
    }

    async debug_bundler_clearMempool(): Promise<BundlerClearMempoolResponseResult> {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_clearMempool is only available in development environment"
            )
        }
        this.mempool.clear()
        this.reputationManager.clearEntityCount()
        return "ok"
    }

    async debug_bundler_dumpMempool(
        entryPoint: Address
    ): Promise<BundlerDumpMempoolResponseResult> {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_dumpMempool is only available in development environment"
            )
        }
        if (this.entryPoint !== entryPoint) {
            throw new RpcError(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.entryPoint}`
            )
        }
        return this.mempool
            .dumpOutstanding()
            .map((userOpInfo) => deriveUserOperation(userOpInfo.mempoolUserOperation))
    }

    async debug_bundler_sendBundleNow(): Promise<BundlerSendBundleNowResponseResult> {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_sendBundleNow is only available in development environment"
            )
        }
        return this.executorManager.bundleNow()
    }

    async debug_bundler_setBundlingMode(
        bundlingMode: BundlingMode
    ): Promise<BundlerSetBundlingModeResponseResult> {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_setBundlingMode is only available in development environment"
            )
        }
        this.executorManager.setBundlingMode(bundlingMode)
        return "ok"
    }

    async debug_bundler_dumpReputation(
        entryPoint: Address
    ): Promise<BundlerDumpReputationsResponseResult> {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_setRe is only available in development environment"
            )
        }
        if (this.entryPoint !== entryPoint) {
            throw new RpcError(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.entryPoint}`
            )
        }
        return this.reputationManager.dumpReputations()
    }

    async debug_bundler_getStakeStatus(
        address: Address,
        entryPoint: Address
    ): Promise<BundlerGetStakeStatusResponseResult> {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_getStakeStatus is only available in development environment"
            )
        }
        if (this.entryPoint !== entryPoint) {
            throw new RpcError(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.entryPoint}`
            )
        }
        return bundlerGetStakeStatusResponseSchema.parse({
            method: "debug_bundler_getStakeStatus",
            result: await this.reputationManager.getStakeStatus(address)
        }).result
    }

    async debug_bundler_setReputation(
        args: BundlerSetReputationsRequestParams
    ): Promise<BundlerSetBundlingModeResponseResult> {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_setReputation is only available in development environment"
            )
        }
        this.reputationManager.setReputation(args[0])
        return "ok"
    }

    async pimlico_getUserOperationStatus(
        userOperationHash: HexData32
    ): Promise<PimlicoGetUserOperationStatusResponseResult> {
        return this.monitor.getUserOperationStatus(userOperationHash)
    }

    async pimlico_getUserOperationGasPrice(): Promise<PimlicoGetUserOperationGasPriceResponseResult> {
        const gasPrice = await getGasPrice(
            this.chainId,
            this.publicClient,
            this.logger
        )
        return {
            slow: {
                maxFeePerGas: (gasPrice.maxFeePerGas * 105n) / 100n,
                maxPriorityFeePerGas:
                    (gasPrice.maxPriorityFeePerGas * 105n) / 100n
            },
            standard: {
                maxFeePerGas: (gasPrice.maxFeePerGas * 110n) / 100n,
                maxPriorityFeePerGas:
                    (gasPrice.maxPriorityFeePerGas * 110n) / 100n
            },
            fast: {
                maxFeePerGas: (gasPrice.maxFeePerGas * 115n) / 100n,
                maxPriorityFeePerGas:
                    (gasPrice.maxPriorityFeePerGas * 115n) / 100n
            }
        }
    }

    // check if we want to bundle userOperation. If yes, add to mempool
    async addToMempoolIfValid(op: MempoolUserOperation, entryPoint: Address) {
        const userOperation = deriveUserOperation(op)
        if (this.entryPoint !== entryPoint) {
            throw new RpcError(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.entryPoint}`
            )
        }

        if (
            this.chainId === chains.celoAlfajores.id ||
            this.chainId === chains.celo.id
        ) {
            if (
                userOperation.maxFeePerGas !==
                userOperation.maxPriorityFeePerGas
            ) {
                throw new RpcError(
                    "maxPriorityFeePerGas must equal maxFeePerGas on Celo chains"
                )
            }
        }

        if (this.minimumGasPricePercent !== 0) {
            const gasPrice = await getGasPrice(
                this.chainId,
                this.publicClient,
                this.logger
            )
            const minMaxFeePerGas =
                (gasPrice.maxFeePerGas * BigInt(this.minimumGasPricePercent)) /
                100n
            if (userOperation.maxFeePerGas < minMaxFeePerGas) {
                throw new RpcError(
                    `maxFeePerGas must be at least ${minMaxFeePerGas} (current maxFeePerGas: ${gasPrice.maxFeePerGas}) - use pimlico_getUserOperationGasPrice to get the current gas price`
                )
            }

            if (userOperation.maxPriorityFeePerGas < minMaxFeePerGas) {
                throw new RpcError(
                    `maxPriorityFeePerGas must be at least ${minMaxFeePerGas} (current maxPriorityFeePerGas: ${gasPrice.maxPriorityFeePerGas}) - use pimlico_getUserOperationGasPrice to get the current gas price`
                )
            }
        }

        if (userOperation.verificationGasLimit < 10000n) {
            throw new RpcError("verificationGasLimit must be at least 10000")
        }

        this.logger.trace({ userOperation, entryPoint }, "beginning validation")
        this.metrics.userOperationsReceived.inc()

        if (
            userOperation.preVerificationGas === 0n ||
            userOperation.verificationGasLimit === 0n ||
            userOperation.callGasLimit === 0n
        ) {
            throw new RpcError(
                "user operation gas limits must be larger than 0"
            )
        }

        const entryPointContract = getContract({
            address: this.entryPoint,
            abi: EntryPointAbi,
            publicClient: this.publicClient
        })

        const [nonceKey, userOperationNonceValue] = getNonceKeyAndValue(
            userOperation.nonce
        )

        const getNonceResult = await entryPointContract.read.getNonce(
            [userOperation.sender, nonceKey],
            {
                blockTag: "latest"
            }
        )

        const [_, currentNonceValue] = getNonceKeyAndValue(getNonceResult)

        if (userOperationNonceValue < currentNonceValue) {
            throw new RpcError(
                "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                ValidationErrors.SimulateValidation
            )
        }
        if (userOperationNonceValue > currentNonceValue + 10n) {
            throw new RpcError(
                "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                ValidationErrors.SimulateValidation
            )
        }
        if (userOperationNonceValue === currentNonceValue) {
            const validationResult =
                await this.validator.validateUserOperation(userOperation)
            await this.reputationManager.checkReputation(
                userOperation,
                validationResult
            )
            await this.mempool.checkEntityMultipleRoleViolation(userOperation)
            const success = this.mempool.add(
                op,
                validationResult.referencedContracts
            )
            if (!success) {
                throw new RpcError(
                    "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                    ValidationErrors.SimulateValidation
                )
            }
        } else {
            this.nonceQueuer.add(userOperation)
        }
    }

    async pimlico_sendCompressedUserOperation(
        compressedCalldata: Hex,
        inflatorAddress: Address,
        entryPoint: Address,
    ) {
        if (this.compressionHandler === null) {
            throw new RpcError("Endpoint not supported")
        }

        // check if inflator is registered with our PerOpInflator.
        const inflatorId = await this.compressionHandler.getInflatorRegisteredId(inflatorAddress, this.publicClient)

        if (inflatorId === 0) {
            throw new RpcError(`Inflator ${inflatorAddress} is not registered`, ValidationErrors.InvalidFields)
        }

        // infalte + start to validate user op.
        const inflatorContract = getContract({
            address: inflatorAddress,
            abi: IOpInflatorAbi,
            publicClient: this.publicClient,
        })

        let inflatedOp: UserOperation
        try {
            inflatedOp = await inflatorContract.read.inflate([compressedCalldata])
        } catch (e) {
            throw new RpcError(
                `Inflator ${inflatorAddress} failed to inflate calldata ${compressedCalldata}, due to ${e}`,
                ValidationErrors.InvalidFields
            )
        }

        // check if perUseropIsRegisterd to target BundleBulker
        const perOpInflatorId = this.compressionHandler.perOpInflatorId

        if (perOpInflatorId === 0) {
            throw new RpcError(`PerUserOp ${this.compressionHandler.perOpInflatorAddress} has not been registered with BundelBulker`, ValidationErrors.InvalidFields)
        }

        const compressedUserOp: CompressedUserOperation = {
            compressedCalldata,
            inflatedOp,
            inflatorAddress,
            inflatorId,
        };

        // check userOps inputs.
        await this.addToMempoolIfValid(compressedUserOp, entryPoint)

        const hash = getUserOperationHash(
            inflatedOp,
            entryPoint,
            this.chainId
        )

        return hash
    }
}
