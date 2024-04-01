import type { GasPriceManager, Logger, Metrics } from "@alto/utils"
import type {
    ExecutorManager,
    InterfaceExecutor
} from "@entrypoint-0.7/executor"
import type {
    InterfaceReputationManager,
    Mempool,
    Monitor
} from "@entrypoint-0.7/mempool"
import type {
    ApiVersion,
    PackedUserOperation,
    StateOverrides,
    UnPackedUserOperation
} from "@entrypoint-0.7/types"
import {
    EntryPointAbi,
    IOpInflatorAbi,
    RpcError,
    ValidationErrors,
    bundlerGetStakeStatusResponseSchema,
    deriveUserOperation,
    logSchema,
    receiptSchema,
    type Address,
    type BundlerClearMempoolResponseResult,
    type BundlerClearStateResponseResult,
    type BundlerDumpMempoolResponseResult,
    type BundlerDumpReputationsResponseResult,
    type BundlerGetStakeStatusResponseResult,
    type BundlerRequest,
    type BundlerResponse,
    type BundlerSendBundleNowResponseResult,
    type BundlerSetBundlingModeResponseResult,
    type BundlerSetReputationsRequestParams,
    type BundlingMode,
    type ChainIdResponseResult,
    type CompressedUserOperation,
    type Environment,
    type EstimateUserOperationGasResponseResult,
    type GetUserOperationByHashResponseResult,
    type GetUserOperationReceiptResponseResult,
    type HexData32,
    type InterfaceValidator,
    type MempoolUserOperation,
    type PimlicoGetUserOperationGasPriceResponseResult,
    type PimlicoGetUserOperationStatusResponseResult,
    type SendUserOperationResponseResult,
    type SupportedEntryPointsResponseResult
} from "@entrypoint-0.7/types"
import {
    calcPreVerificationGas,
    calcVerificationGasAndCallGasLimit,
    getNonceKeyAndValue,
    getUserOperationHash,
    toPackedUserOperation,
    toUnPackedUserOperation,
    type CompressionHandler
} from "@entrypoint-0.7/utils"
import {
    TransactionNotFoundError,
    TransactionReceiptNotFoundError,
    decodeFunctionData,
    getAbiItem,
    getContract,
    type Chain,
    type Hex,
    type PublicClient,
    type Transaction,
    type TransactionReceipt,
    type Transport
} from "viem"
import * as chains from "viem/chains"
import { z } from "zod"
import { fromZodError } from "zod-validation-error"
import type { NonceQueuer } from "./nonceQueuer"

export interface InterfaceRpcEndpoint {
    handleMethod(request: BundlerRequest): Promise<BundlerResponse>
    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    eth_chainId(): ChainIdResponseResult
    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    eth_supportedEntryPoints(): SupportedEntryPointsResponseResult
    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    eth_estimateUserOperationGas(
        userOperation: UnPackedUserOperation,
        entryPoint: Address,
        stateOverrides?: StateOverrides
    ): Promise<EstimateUserOperationGasResponseResult>
    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    eth_sendUserOperation(
        userOperation: UnPackedUserOperation,
        entryPoint: Address
    ): Promise<SendUserOperationResponseResult>
    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    eth_getUserOperationByHash(
        userOperationHash: HexData32
    ): Promise<GetUserOperationByHashResponseResult>
    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    eth_getUserOperationReceipt(
        userOperationHash: HexData32
    ): Promise<GetUserOperationReceiptResponseResult>
}

export class RpcHandler implements InterfaceRpcEndpoint {
    entryPoint: Address
    publicClient: PublicClient<Transport, Chain>
    validator: InterfaceValidator
    mempool: Mempool
    executor: InterfaceExecutor
    monitor: Monitor
    nonceQueuer: NonceQueuer
    usingTenderly: boolean
    minimumGasPricePercent: number
    apiVersion: ApiVersion
    noEthCallOverrideSupport: boolean
    rpcMaxBlockRange: number | undefined
    logger: Logger
    metrics: Metrics
    chainId: number
    environment: Environment
    executorManager: ExecutorManager
    reputationManager: InterfaceReputationManager
    compressionHandler: CompressionHandler | null
    noEip1559Support: boolean
    dangerousSkipUserOperationValidation: boolean
    gasPriceManager: GasPriceManager

    constructor(
        entryPoint: Address,
        publicClient: PublicClient<Transport, Chain>,
        validator: InterfaceValidator,
        mempool: Mempool,
        executor: InterfaceExecutor,
        monitor: Monitor,
        nonceQueuer: NonceQueuer,
        executorManager: ExecutorManager,
        reputationManager: InterfaceReputationManager,
        usingTenderly: boolean,
        minimumGasPricePercent: number,
        apiVersion: ApiVersion,
        noEthCallOverrideSupport: boolean,
        rpcMaxBlockRange: number | undefined,
        logger: Logger,
        metrics: Metrics,
        environment: Environment,
        compressionHandler: CompressionHandler | null,
        noEip1559Support: boolean,
        gasPriceManager: GasPriceManager,
        dangerousSkipUserOperationValidation = false
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
        this.apiVersion = apiVersion
        this.noEthCallOverrideSupport = noEthCallOverrideSupport
        this.rpcMaxBlockRange = rpcMaxBlockRange
        this.logger = logger
        this.metrics = metrics
        this.environment = environment
        this.chainId = publicClient.chain.id
        this.executorManager = executorManager
        this.reputationManager = reputationManager
        this.compressionHandler = compressionHandler
        this.noEip1559Support = noEip1559Support
        this.gasPriceManager = gasPriceManager
        this.dangerousSkipUserOperationValidation =
            dangerousSkipUserOperationValidation
    }

    async handleMethod(request: BundlerRequest): Promise<BundlerResponse> {
        // call the method with the params
        const method = request.method
        switch (method) {
            case "eth_chainId":
                return {
                    method,
                    result: this.eth_chainId(...request.params)
                }
            case "eth_supportedEntryPoints":
                return {
                    method,
                    result: this.eth_supportedEntryPoints(...request.params)
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
                    result: this.debug_bundler_clearMempool(...request.params)
                }
            case "debug_bundler_clearState":
                return {
                    method,
                    result: this.debug_bundler_clearState(...request.params)
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
                    result: this.debug_bundler_setBundlingMode(
                        ...request.params
                    )
                }
            case "debug_bundler_setReputation":
                return {
                    method,
                    result: this.debug_bundler_setReputation(request.params)
                }
            case "debug_bundler_dumpReputation":
                return {
                    method,
                    result: this.debug_bundler_dumpReputation(...request.params)
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
                    result: this.pimlico_getUserOperationStatus(
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
                    result: await this.pimlico_sendCompressedUserOperation(
                        ...request.params
                    )
                }
        }
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    eth_chainId(): ChainIdResponseResult {
        return BigInt(this.chainId)
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    eth_supportedEntryPoints(): SupportedEntryPointsResponseResult {
        return [this.entryPoint]
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    async eth_estimateUserOperationGas(
        userOperation: UnPackedUserOperation,
        entryPoint: Address,
        stateOverrides?: StateOverrides
    ): Promise<EstimateUserOperationGasResponseResult> {
        // check if entryPoint is supported, if not throw
        if (this.entryPoint !== entryPoint) {
            throw new RpcError(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.entryPoint}`
            )
        }

        if (userOperation.maxFeePerGas === 0n) {
            throw new RpcError(
                "user operation max fee per gas must be larger than 0 during gas estimation"
            )
        }

        let preVerificationGas = await calcPreVerificationGas(
            this.publicClient,
            userOperation,
            entryPoint,
            this.chainId
        )

        if (
            this.chainId === chains.optimism.id ||
            this.chainId === chains.optimismSepolia.id ||
            this.chainId === chains.optimismGoerli.id ||
            this.chainId === chains.base.id ||
            this.chainId === chains.baseGoerli.id ||
            this.chainId === chains.baseSepolia.id ||
            this.chainId === chains.opBNB.id ||
            this.chainId === chains.opBNBTestnet.id ||
            this.chainId === 957 ||
            this.chainId === chains.arbitrum.id ||
            this.chainId === chains.arbitrumNova.id
        ) {
            // Optimism and Arbitrum have a pre verification gas limit dependent on the gas price
            // so we increase the requirement by 1.3x to incorporate the gas price. we do 2x because now calldata is super cheap on l1
            preVerificationGas = (preVerificationGas * 130n) / 100n
        }

        userOperation.preVerificationGas = 1_000_000n
        userOperation.verificationGasLimit = 10_000_000n
        userOperation.callGasLimit = 10_000_000n

        userOperation.paymasterPostOpGasLimit = 2_000_000n
        userOperation.paymasterVerificationGasLimit = 5_000_000n
        userOperation.maxPriorityFeePerGas = userOperation.maxFeePerGas

        if (this.chainId === chains.base.id) {
            userOperation.verificationGasLimit = 2_500_000n
            userOperation.callGasLimit = 2_500_000n
        }

        if (
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
        const [verificationGasLimit, callGasLimit] =
            await calcVerificationGasAndCallGasLimit(
                this.publicClient,
                userOperation,
                executionResult,
                this.chainId
            )

        if (this.apiVersion === "v2") {
            return {
                preVerificationGas,
                verificationGasLimit,
                callGasLimit,
                paymasterVerificationGasLimit: verificationGasLimit,
                paymasterPostOpGasLimit: verificationGasLimit
            }
        }

        return {
            preVerificationGas,
            verificationGasLimit,
            callGasLimit
        }
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    async eth_sendUserOperation(
        userOperation: UnPackedUserOperation,
        entryPoint: Address
    ): Promise<SendUserOperationResponseResult> {
        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            status = await this.addToMempoolIfValid(userOperation, entryPoint)

            const hash = getUserOperationHash(
                toPackedUserOperation(userOperation),
                entryPoint,
                this.chainId
            )
            return hash
        } catch (error) {
            status = "rejected"
            throw error
        } finally {
            this.metrics.userOperationsReceived
                .labels({
                    status,
                    type: "regular"
                })
                .inc()
        }
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
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
        let op: PackedUserOperation | undefined = undefined
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
                (op: PackedUserOperation) =>
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
            userOperation: toUnPackedUserOperation(op),
            entryPoint: this.entryPoint,
            transactionHash: txHash,
            blockHash: tx.blockHash ?? "0x",
            blockNumber: BigInt(tx.blockNumber ?? 0n)
        }

        return result
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
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
            while (true) {
                try {
                    return await this.publicClient.getTransactionReceipt({
                        hash: txHash
                    })
                } catch (e) {
                    if (e instanceof TransactionReceiptNotFoundError) {
                        continue
                    }

                    throw e
                }
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
                } else if (endIndex === -1) {
                    // it's a different hash. remember it as beginning index, but only if we didn't find our end index yet.
                    startIndex = index
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

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    debug_bundler_clearState(): BundlerClearStateResponseResult {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_clearState is only available in development environment"
            )
        }
        this.mempool.clear()
        this.reputationManager.clear()
        return "ok"
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    debug_bundler_clearMempool(): BundlerClearMempoolResponseResult {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_clearMempool is only available in development environment"
            )
        }
        this.mempool.clear()
        this.reputationManager.clearEntityCount()
        return "ok"
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
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
            .map((userOpInfo) =>
                deriveUserOperation(userOpInfo.mempoolUserOperation)
            )
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    debug_bundler_sendBundleNow(): Promise<BundlerSendBundleNowResponseResult> {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_sendBundleNow is only available in development environment"
            )
        }
        return this.executorManager.bundleNow()
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    debug_bundler_setBundlingMode(
        bundlingMode: BundlingMode
    ): BundlerSetBundlingModeResponseResult {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_setBundlingMode is only available in development environment"
            )
        }
        this.executorManager.setBundlingMode(bundlingMode)
        return "ok"
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    debug_bundler_dumpReputation(
        entryPoint: Address
    ): BundlerDumpReputationsResponseResult {
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

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
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

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    debug_bundler_setReputation(
        args: BundlerSetReputationsRequestParams
    ): BundlerSetBundlingModeResponseResult {
        if (this.environment !== "development") {
            throw new RpcError(
                "debug_bundler_setReputation is only available in development environment"
            )
        }
        this.reputationManager.setReputation(args[0])
        return "ok"
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    pimlico_getUserOperationStatus(
        userOperationHash: HexData32
    ): PimlicoGetUserOperationStatusResponseResult {
        return this.monitor.getUserOperationStatus(userOperationHash)
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    async pimlico_getUserOperationGasPrice(): Promise<PimlicoGetUserOperationGasPriceResponseResult> {
        const gasPrice = await this.gasPriceManager.getGasPrice()
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
    async addToMempoolIfValid(
        op: MempoolUserOperation,
        entryPoint: Address
    ): Promise<"added" | "queued"> {
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

        await this.gasPriceManager.validateGasPrice({
            maxFeePerGas: userOperation.maxFeePerGas,
            maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas
        })

        if (userOperation.verificationGasLimit < 10000n) {
            throw new RpcError("verificationGasLimit must be at least 10000")
        }

        this.logger.trace({ userOperation, entryPoint }, "beginning validation")

        if (
            userOperation.preVerificationGas === 0n ||
            userOperation.verificationGasLimit === 0n
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
                ValidationErrors.InvalidFields
            )
        }
        if (userOperationNonceValue > currentNonceValue + 10n) {
            throw new RpcError(
                "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                ValidationErrors.InvalidFields
            )
        }
        if (userOperationNonceValue === currentNonceValue) {
            if (this.dangerousSkipUserOperationValidation) {
                const success = this.mempool.add(userOperation)
                if (!success) {
                    throw new RpcError(
                        "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                        ValidationErrors.InvalidFields
                    )
                }
            } else {
                await this.validator.validatePreVerificationGas(userOperation)

                const validationResult =
                    await this.validator.validateUserOperation(userOperation)
                await this.reputationManager.checkReputation(
                    userOperation,
                    validationResult
                )
                await this.mempool.checkEntityMultipleRoleViolation(
                    userOperation
                )
                const success = this.mempool.add(
                    op,
                    validationResult.referencedContracts
                )
                if (!success) {
                    throw new RpcError(
                        "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                        ValidationErrors.InvalidFields
                    )
                }
                return "added"
            }
        }

        this.nonceQueuer.add(userOperation)
        return "queued"
    }

    // biome-ignore lint/style/useNamingConvention: want to name it same as rpc for easy search
    async pimlico_sendCompressedUserOperation(
        compressedCalldata: Hex,
        inflatorAddress: Address,
        entryPoint: Address
    ) {
        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            const { inflatedOp, inflatorId } =
                await this.validateAndInflateCompressedUserOperation(
                    inflatorAddress,
                    compressedCalldata
                )

            const compressedUserOp: CompressedUserOperation = {
                compressedCalldata,
                inflatedOp,
                inflatorAddress,
                inflatorId
            }

            // check userOps inputs.
            status = await this.addToMempoolIfValid(
                compressedUserOp,
                entryPoint
            )

            const hash = getUserOperationHash(
                toPackedUserOperation(inflatedOp),
                entryPoint,
                this.chainId
            )

            return hash
        } catch (error) {
            status = "rejected"
            throw error
        } finally {
            this.metrics.userOperationsReceived
                .labels({
                    status,
                    type: "compressed"
                })
                .inc()
        }
    }

    private async validateAndInflateCompressedUserOperation(
        inflatorAddress: Address,
        compressedCalldata: Hex
    ): Promise<{ inflatedOp: UnPackedUserOperation; inflatorId: number }> {
        // check if inflator is registered with our PerOpInflator.
        if (this.compressionHandler === null) {
            throw new RpcError("Endpoint not supported")
        }

        const inflatorId =
            await this.compressionHandler.getInflatorRegisteredId(
                inflatorAddress,
                this.publicClient
            )

        if (inflatorId === 0) {
            throw new RpcError(
                `Inflator ${inflatorAddress} is not registered`,
                ValidationErrors.InvalidFields
            )
        }

        // infalte + start to validate user op.
        const inflatorContract = getContract({
            address: inflatorAddress,
            abi: IOpInflatorAbi,
            publicClient: this.publicClient
        })

        let inflatedOp: PackedUserOperation
        try {
            inflatedOp = await inflatorContract.read.inflate([
                compressedCalldata
            ])
        } catch (e) {
            throw new RpcError(
                `Inflator ${inflatorAddress} failed to inflate calldata ${compressedCalldata}, due to ${e}`,
                ValidationErrors.InvalidFields
            )
        }

        // check if perUseropIsRegisterd to target BundleBulker
        const perOpInflatorId = this.compressionHandler.perOpInflatorId

        if (perOpInflatorId === 0) {
            throw new RpcError(
                `PerUserOp ${this.compressionHandler.perOpInflatorAddress} has not been registered with BundelBulker`,
                ValidationErrors.InvalidFields
            )
        }
        return { inflatedOp: toUnPackedUserOperation(inflatedOp), inflatorId }
    }
}
