import type { Executor, ExecutorManager } from "@alto/executor"
import type {
    InterfaceReputationManager,
    MemoryMempool,
    Monitor
} from "@alto/mempool"
import type {
    ApiVersion,
    PackedUserOperation,
    StateOverrides,
    UserOperationV06
} from "@alto/types"
import {
    EntryPointV06Abi,
    EntryPointV07Abi,
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
    type EstimateUserOperationGasResponseResult,
    type GetUserOperationByHashResponseResult,
    type GetUserOperationReceiptResponseResult,
    type HexData32,
    type InterfaceValidator,
    type MempoolUserOperation,
    type PimlicoGetUserOperationGasPriceResponseResult,
    type PimlicoGetUserOperationStatusResponseResult,
    type SendUserOperationResponseResult,
    type SupportedEntryPointsResponseResult,
    type UserOperation
} from "@alto/types"
import type { GasPriceManager, Logger, Metrics } from "@alto/utils"
import {
    calcPreVerificationGas,
    calcVerificationGasAndCallGasLimit,
    getNonceKeyAndValue,
    getUserOperationHash,
    isVersion06,
    isVersion07,
    maxBigInt,
    toUnpackedUserOperation,
    type CompressionHandler
} from "@alto/utils"
import {
    TransactionNotFoundError,
    TransactionReceiptNotFoundError,
    decodeFunctionData,
    getAbiItem,
    getAddress,
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

export interface IRpcEndpoint {
    handleMethod(
        request: BundlerRequest,
        apiVersion: ApiVersion
    ): Promise<BundlerResponse>
    eth_chainId(): ChainIdResponseResult
    eth_supportedEntryPoints(): SupportedEntryPointsResponseResult
    eth_estimateUserOperationGas(
        apiVersion: ApiVersion,
        userOperation: UserOperation,
        entryPoint: Address,
        stateOverrides?: StateOverrides
    ): Promise<EstimateUserOperationGasResponseResult>
    eth_sendUserOperation(
        apiVersion: ApiVersion,
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
    entryPoints: Address[]
    publicClient: PublicClient<Transport, Chain>
    validator: InterfaceValidator
    mempool: MemoryMempool
    executor: Executor
    monitor: Monitor
    nonceQueuer: NonceQueuer
    usingTenderly: boolean
    rpcMaxBlockRange: number | undefined
    logger: Logger
    metrics: Metrics
    chainId: number
    enableDebugEndpoints: boolean
    executorManager: ExecutorManager
    reputationManager: InterfaceReputationManager
    compressionHandler: CompressionHandler | null
    legacyTransactions: boolean
    dangerousSkipUserOperationValidation: boolean
    gasPriceManager: GasPriceManager

    constructor(
        entryPoints: Address[],
        publicClient: PublicClient<Transport, Chain>,
        validator: InterfaceValidator,
        mempool: MemoryMempool,
        executor: Executor,
        monitor: Monitor,
        nonceQueuer: NonceQueuer,
        executorManager: ExecutorManager,
        reputationManager: InterfaceReputationManager,
        usingTenderly: boolean,
        rpcMaxBlockRange: number | undefined,
        logger: Logger,
        metrics: Metrics,
        enableDebugEndpoints: boolean,
        compressionHandler: CompressionHandler | null,
        legacyTransactions: boolean,
        gasPriceManager: GasPriceManager,
        dangerousSkipUserOperationValidation = false
    ) {
        this.entryPoints = entryPoints
        this.publicClient = publicClient
        this.validator = validator
        this.mempool = mempool
        this.executor = executor
        this.monitor = monitor
        this.nonceQueuer = nonceQueuer
        this.usingTenderly = usingTenderly
        this.rpcMaxBlockRange = rpcMaxBlockRange
        this.logger = logger
        this.metrics = metrics
        this.enableDebugEndpoints = enableDebugEndpoints
        this.chainId = publicClient.chain.id
        this.executorManager = executorManager
        this.reputationManager = reputationManager
        this.compressionHandler = compressionHandler
        this.legacyTransactions = legacyTransactions
        this.dangerousSkipUserOperationValidation =
            dangerousSkipUserOperationValidation
        this.gasPriceManager = gasPriceManager
    }

    async handleMethod(
        request: BundlerRequest,
        apiVersion: ApiVersion
    ): Promise<BundlerResponse> {
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
                        apiVersion,
                        request.params[0],
                        request.params[1],
                        request.params[2]
                    )
                }
            case "eth_sendUserOperation":
                return {
                    method,
                    result: await this.eth_sendUserOperation(
                        apiVersion,
                        ...request.params
                    )
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
                        apiVersion,
                        ...request.params
                    )
                }
        }
    }

    eth_chainId(): ChainIdResponseResult {
        return BigInt(this.chainId)
    }

    eth_supportedEntryPoints(): SupportedEntryPointsResponseResult {
        return this.entryPoints
    }

    async eth_estimateUserOperationGas(
        apiVersion: ApiVersion,
        userOperation: UserOperation,
        entryPoint: Address,
        stateOverrides?: StateOverrides
    ): Promise<EstimateUserOperationGasResponseResult> {
        // check if entryPoint is supported, if not throw
        if (!this.entryPoints.includes(entryPoint)) {
            throw new Error(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.entryPoints.join(
                    ", "
                )}`
            )
        }

        if (userOperation.maxFeePerGas === 0n) {
            throw new RpcError(
                "user operation max fee per gas must be larger than 0 during gas estimation"
            )
        }
        const preVerificationGas =
            ((await calcPreVerificationGas(
                this.publicClient,
                userOperation,
                entryPoint,
                this.chainId
            )) *
                110n) /
            100n

        userOperation.preVerificationGas = 1_000_000n
        userOperation.verificationGasLimit = 10_000_000n
        userOperation.callGasLimit = 10_000_000n

        if (this.chainId === chains.base.id) {
            userOperation.verificationGasLimit = 5_000_000n
        }

        if (
            this.chainId === chains.celoAlfajores.id ||
            this.chainId === chains.celo.id
        ) {
            userOperation.verificationGasLimit = 1_000_000n
            userOperation.callGasLimit = 1_000_000n
        }

        if (isVersion07(userOperation)) {
            userOperation.paymasterPostOpGasLimit = 2_000_000n
            userOperation.paymasterVerificationGasLimit = 5_000_000n
        }

        // This is necessary because entryPoint pays
        // min(maxFeePerGas, baseFee + maxPriorityFeePerGas) for the verification
        // Since we don't want our estimations to depend upon baseFee, we set
        // maxFeePerGas to maxPriorityFeePerGas
        userOperation.maxPriorityFeePerGas = userOperation.maxFeePerGas

        const executionResult = await this.validator.getExecutionResult(
            userOperation,
            entryPoint,
            stateOverrides
        )

        let { verificationGasLimit, callGasLimit } =
            calcVerificationGasAndCallGasLimit(
                userOperation,
                executionResult.data.executionResult,
                this.chainId,
                executionResult.data.callDataResult
            )

        let paymasterVerificationGasLimit = 0n
        let paymasterPostOpGasLimit = 0n

        if (
            isVersion07(userOperation) && 
            userOperation.paymaster !== null &&
            "paymasterVerificationGasLimit" in
                executionResult.data.executionResult &&
            "paymasterPostOpGasLimit" in executionResult.data.executionResult
        ) {
            paymasterVerificationGasLimit =
                executionResult.data.executionResult
                    .paymasterVerificationGasLimit || 1n
            paymasterPostOpGasLimit =
                executionResult.data.executionResult.paymasterPostOpGasLimit ||
                1n
        }

        if (
            this.chainId === chains.base.id ||
            this.chainId === chains.baseSepolia.id
        ) {
            callGasLimit += 10_000n
        }

        if (
            this.chainId === chains.base.id ||
            this.chainId === chains.optimism.id
        ) {
            callGasLimit = maxBigInt(callGasLimit, 120_000n)
        }

        if (userOperation.callData === "0x") {
            callGasLimit = 0n
        }

        if (isVersion07(userOperation)) {
            return {
                preVerificationGas,
                verificationGasLimit,
                callGasLimit,
                paymasterVerificationGasLimit,
                paymasterPostOpGasLimit
            }
        }

        if (apiVersion === "v2") {
            return {
                preVerificationGas,
                verificationGasLimit,
                callGasLimit
            }
        }

        return {
            preVerificationGas,
            verificationGas: verificationGasLimit,
            verificationGasLimit,
            callGasLimit
        }
    }

    async eth_sendUserOperation(
        apiVersion: ApiVersion,
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<SendUserOperationResponseResult> {
        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            status = await this.addToMempoolIfValid(
                userOperation,
                entryPoint,
                apiVersion
            )

            const hash = getUserOperationHash(
                userOperation,
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

    async eth_getUserOperationByHash(
        userOperationHash: HexData32
    ): Promise<GetUserOperationByHashResponseResult> {
        const userOperationEventAbiItem = getAbiItem({
            abi: EntryPointV06Abi,
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
            address: this.entryPoints,
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

        if (!tx.to) {
            return null
        }

        let op: UserOperationV06 | PackedUserOperation | undefined = undefined
        try {
            const decoded = decodeFunctionData({
                abi: EntryPointV06Abi,
                data: tx.input
            })
            if (decoded.functionName !== "handleOps") {
                return null
            }
            const ops = decoded.args[0]
            op = ops.find(
                (op: UserOperationV06 | PackedUserOperation) =>
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
            userOperation: isVersion06(op) ? op : toUnpackedUserOperation(op),
            entryPoint: getAddress(tx.to),
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
            abi: EntryPointV06Abi,
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
            address: this.entryPoints,
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

    debug_bundler_clearState(): BundlerClearStateResponseResult {
        if (!this.enableDebugEndpoints) {
            throw new RpcError(
                "debug_bundler_clearState is only available in development environment"
            )
        }
        this.mempool.clear()
        this.reputationManager.clear()
        return "ok"
    }

    debug_bundler_clearMempool(): BundlerClearMempoolResponseResult {
        if (!this.enableDebugEndpoints) {
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
        if (!this.enableDebugEndpoints) {
            throw new RpcError(
                "debug_bundler_dumpMempool is only available in development environment"
            )
        }
        if (!this.entryPoints.includes(entryPoint)) {
            throw new RpcError(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.entryPoints.join(
                    ", "
                )}`
            )
        }
        return this.mempool
            .dumpOutstanding()
            .map((userOpInfo) =>
                deriveUserOperation(userOpInfo.mempoolUserOperation)
            )
    }

    async debug_bundler_sendBundleNow(): Promise<BundlerSendBundleNowResponseResult> {
        if (!this.enableDebugEndpoints) {
            throw new RpcError(
                "debug_bundler_sendBundleNow is only available in development environment"
            )
        }
        const transactions = await this.executorManager.bundleNow()
        return transactions[0]
    }

    debug_bundler_setBundlingMode(
        bundlingMode: BundlingMode
    ): BundlerSetBundlingModeResponseResult {
        if (!this.enableDebugEndpoints) {
            throw new RpcError(
                "debug_bundler_setBundlingMode is only available in development environment"
            )
        }
        this.executorManager.setBundlingMode(bundlingMode)
        return "ok"
    }

    debug_bundler_dumpReputation(
        entryPoint: Address
    ): BundlerDumpReputationsResponseResult {
        if (!this.enableDebugEndpoints) {
            throw new RpcError(
                "debug_bundler_setRe is only available in development environment"
            )
        }
        if (!this.entryPoints.includes(entryPoint)) {
            throw new RpcError(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.entryPoints.join(
                    ", "
                )}`
            )
        }
        return this.reputationManager.dumpReputations(entryPoint)
    }

    async debug_bundler_getStakeStatus(
        address: Address,
        entryPoint: Address
    ): Promise<BundlerGetStakeStatusResponseResult> {
        if (!this.enableDebugEndpoints) {
            throw new RpcError(
                "debug_bundler_getStakeStatus is only available in development environment"
            )
        }
        if (!this.entryPoints.includes(entryPoint)) {
            throw new RpcError(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.entryPoints.join(
                    ", "
                )}`
            )
        }
        return bundlerGetStakeStatusResponseSchema.parse({
            method: "debug_bundler_getStakeStatus",
            result: await this.reputationManager.getStakeStatus(
                entryPoint,
                address
            )
        }).result
    }

    debug_bundler_setReputation(
        args: BundlerSetReputationsRequestParams
    ): BundlerSetBundlingModeResponseResult {
        if (!this.enableDebugEndpoints) {
            throw new RpcError(
                "debug_bundler_setReputation is only available in development environment"
            )
        }
        this.reputationManager.setReputation(args[1], args[0])
        return "ok"
    }

    pimlico_getUserOperationStatus(
        userOperationHash: HexData32
    ): PimlicoGetUserOperationStatusResponseResult {
        return this.monitor.getUserOperationStatus(userOperationHash)
    }

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
        entryPoint: Address,
        apiVersion: ApiVersion
    ): Promise<"added" | "queued"> {
        const userOperation = deriveUserOperation(op)
        if (!this.entryPoints.includes(entryPoint)) {
            throw new RpcError(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.entryPoints.join(
                    ", "
                )}`
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

        if (apiVersion !== "v1") {
            await this.gasPriceManager.validateGasPrice({
                maxFeePerGas: userOperation.maxFeePerGas,
                maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas
            })
        }

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
            address: entryPoint,
            abi: isVersion06(userOperation)
                ? EntryPointV06Abi
                : EntryPointV07Abi,
            client: {
                public: this.publicClient
            }
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
                const success = this.mempool.add(userOperation, entryPoint)
                if (!success) {
                    throw new RpcError(
                        "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                        ValidationErrors.InvalidFields
                    )
                }
            } else {
                if (apiVersion !== "v1") {
                    await this.validator.validatePreVerificationGas(
                        userOperation,
                        entryPoint
                    )
                }

                const validationResult =
                    await this.validator.validateUserOperation(
                        apiVersion !== "v1",
                        userOperation,
                        entryPoint
                    )

                await this.reputationManager.checkReputation(
                    userOperation,
                    entryPoint,
                    validationResult
                )

                await this.mempool.checkEntityMultipleRoleViolation(
                    userOperation
                )

                const success = this.mempool.add(
                    op,
                    entryPoint,
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

        this.nonceQueuer.add(userOperation, entryPoint)
        return "queued"
    }

    async pimlico_sendCompressedUserOperation(
        apiVersion: ApiVersion,
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
                entryPoint,
                apiVersion
            )

            const hash = getUserOperationHash(
                inflatedOp,
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
    ): Promise<{ inflatedOp: UserOperation; inflatorId: number }> {
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
            client: {
                public: this.publicClient
            }
        })

        let inflatedOp: UserOperation
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
        return { inflatedOp, inflatorId }
    }
}
