import type { Executor, ExecutorManager } from "@alto/executor"
import type {
    CompressionHandler,
    EventManager,
    GasPriceManager
} from "@alto/handlers"
import type {
    InterfaceReputationManager,
    MemoryMempool,
    Monitor
} from "@alto/mempool"
import type {
    ApiVersion,
    PackedUserOperation,
    StateOverrides,
    TransactionInfo,
    UserOperationInfo,
    UserOperationV06,
    UserOperationV07
} from "@alto/types"
import {
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
    EntryPointV06Abi,
    EntryPointV07Abi,
    type EstimateUserOperationGasResponseResult,
    type GetUserOperationByHashResponseResult,
    type GetUserOperationReceiptResponseResult,
    type HexData32,
    IOpInflatorAbi,
    type InterfaceValidator,
    type MempoolUserOperation,
    type PimlicoGetUserOperationGasPriceResponseResult,
    type PimlicoGetUserOperationStatusResponseResult,
    RpcError,
    type SendUserOperationResponseResult,
    type SupportedEntryPointsResponseResult,
    type UserOperation,
    ValidationErrors,
    bundlerGetStakeStatusResponseSchema,
    deriveUserOperation
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import {
    calcPreVerificationGas,
    calcVerificationGasAndCallGasLimit,
    deepHexlify,
    getAAError,
    getNonceKeyAndValue,
    getUserOperationHash,
    isVersion06,
    isVersion07,
    maxBigInt,
    parseUserOperationReceipt,
    scaleBigIntByPercent,
    toUnpackedUserOperation
} from "@alto/utils"
import {
    type Hex,
    type Transaction,
    TransactionNotFoundError,
    decodeFunctionData,
    getAbiItem,
    getAddress,
    getContract,
    slice,
    toFunctionSelector
} from "viem"
import { base, baseSepolia, optimism } from "viem/chains"
import type { NonceQueuer } from "./nonceQueuer"
import type { AltoConfig } from "../createConfig"

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
    config: AltoConfig
    validator: InterfaceValidator
    mempool: MemoryMempool
    executor: Executor
    monitor: Monitor
    nonceQueuer: NonceQueuer
    rpcMaxBlockRange: number | undefined
    logger: Logger
    metrics: Metrics
    executorManager: ExecutorManager
    reputationManager: InterfaceReputationManager
    compressionHandler: CompressionHandler | null
    gasPriceManager: GasPriceManager
    eventManager: EventManager

    constructor({
        config,
        validator,
        mempool,
        executor,
        monitor,
        nonceQueuer,
        executorManager,
        reputationManager,
        metrics,
        compressionHandler,
        gasPriceManager,
        eventManager
    }: {
        config: AltoConfig
        validator: InterfaceValidator
        mempool: MemoryMempool
        executor: Executor
        monitor: Monitor
        nonceQueuer: NonceQueuer
        executorManager: ExecutorManager
        reputationManager: InterfaceReputationManager
        metrics: Metrics
        compressionHandler: CompressionHandler | null
        eventManager: EventManager
        gasPriceManager: GasPriceManager
    }) {
        this.config = config
        this.validator = validator
        this.mempool = mempool
        this.executor = executor
        this.monitor = monitor
        this.nonceQueuer = nonceQueuer
        this.logger = config.getLogger(
            { module: "rpc" },
            {
                level: config.rpcLogLevel || config.logLevel
            }
        )
        this.metrics = metrics
        this.executorManager = executorManager
        this.reputationManager = reputationManager
        this.compressionHandler = compressionHandler
        this.gasPriceManager = gasPriceManager
        this.eventManager = eventManager
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
            case "pimlico_sendUserOperationNow":
                return {
                    method,
                    result: await this.pimlico_sendUserOperationNow(
                        apiVersion,
                        ...request.params
                    )
                }
        }
    }

    ensureEntryPointIsSupported(entryPoint: Address) {
        if (!this.config.entrypoints.includes(entryPoint)) {
            throw new Error(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.config.entrypoints.join(
                    ", "
                )}`
            )
        }
    }

    ensureDebugEndpointsAreEnabled(methodName: string) {
        if (!this.config.enableDebugEndpoints) {
            throw new RpcError(
                `${methodName} is only available in development environment`
            )
        }
    }

    async preMempoolChecks(
        opHash: Hex,
        userOperation: UserOperation,
        apiVersion: ApiVersion,
        entryPoint: Address
    ) {
        if (
            this.config.legacyTransactions &&
            userOperation.maxFeePerGas !== userOperation.maxPriorityFeePerGas
        ) {
            const reason =
                "maxPriorityFeePerGas must equal maxFeePerGas on chains that don't support EIP-1559"
            this.eventManager.emitFailedValidation(opHash, reason)
            throw new RpcError(reason)
        }

        if (apiVersion !== "v1") {
            await this.gasPriceManager.validateGasPrice({
                maxFeePerGas: userOperation.maxFeePerGas,
                maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas
            })
        }

        if (userOperation.verificationGasLimit < 10000n) {
            const reason = "verificationGasLimit must be at least 10000"
            this.eventManager.emitFailedValidation(opHash, reason)
            throw new RpcError(reason)
        }

        this.logger.trace({ userOperation, entryPoint }, "beginning validation")

        if (
            userOperation.preVerificationGas === 0n ||
            userOperation.verificationGasLimit === 0n
        ) {
            const reason = "user operation gas limits must be larger than 0"
            this.eventManager.emitFailedValidation(opHash, reason)
            throw new RpcError(reason)
        }
    }

    eth_chainId(): ChainIdResponseResult {
        return BigInt(this.config.publicClient.chain.id)
    }

    eth_supportedEntryPoints(): SupportedEntryPointsResponseResult {
        return this.config.entrypoints
    }

    async eth_estimateUserOperationGas(
        apiVersion: ApiVersion,
        userOperation: UserOperation,
        entryPoint: Address,
        stateOverrides?: StateOverrides
    ): Promise<EstimateUserOperationGasResponseResult> {
        this.ensureEntryPointIsSupported(entryPoint)

        if (userOperation.maxFeePerGas === 0n) {
            throw new RpcError(
                "user operation max fee per gas must be larger than 0 during gas estimation"
            )
        }

        let preVerificationGas = await calcPreVerificationGas({
            config: this.config,
            userOperation,
            entryPoint,
            gasPriceManager: this.gasPriceManager,
            validate: false
        })
        preVerificationGas = scaleBigIntByPercent(preVerificationGas, 110)

        // biome-ignore lint/style/noParameterAssign: prepare userOperaiton for simulation
        userOperation = {
            ...userOperation,
            preVerificationGas: 1_000_000n,
            verificationGasLimit: 10_000_000n,
            callGasLimit: 10_000_000n
        }

        if (this.config.publicClient.chain.id === base.id) {
            userOperation.verificationGasLimit = 5_000_000n
        }

        if (this.config.chainType === "hedera") {
            // The eth_call gasLimit is set to 12_500_000 on Hedera.
            userOperation.verificationGasLimit = 5_000_000n
            userOperation.callGasLimit = 4_500_000n
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

        // Check if the nonce is valid
        // If the nonce is less than the current nonce, the user operation has already been executed
        // If the nonce is greater than the current nonce, we may have missing user operations in the mempool
        const currentNonceValue = await this.getNonceValue(
            userOperation,
            entryPoint
        )
        const [, userOperationNonceValue] = getNonceKeyAndValue(
            userOperation.nonce
        )

        let queuedUserOperations: UserOperation[] = []
        if (userOperationNonceValue < currentNonceValue) {
            throw new RpcError(
                "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                ValidationErrors.InvalidFields
            )
        }
        if (userOperationNonceValue > currentNonceValue) {
            // Nonce queues are supported only for v7 user operations
            if (isVersion06(userOperation)) {
                throw new RpcError(
                    "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                    ValidationErrors.InvalidFields
                )
            }

            queuedUserOperations = await this.mempool.getQueuedUserOperations(
                userOperation,
                entryPoint,
                currentNonceValue
            )

            if (
                userOperationNonceValue >
                currentNonceValue + BigInt(queuedUserOperations.length)
            ) {
                throw new RpcError(
                    "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                    ValidationErrors.InvalidFields
                )
            }
        }

        const executionResult = await this.validator.getExecutionResult(
            userOperation,
            entryPoint,
            queuedUserOperations,
            true,
            stateOverrides
        )

        let { verificationGasLimit, callGasLimit } =
            calcVerificationGasAndCallGasLimit(
                userOperation,
                executionResult.data.executionResult,
                this.config.publicClient.chain.id,
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

            const multiplier = Number(this.config.paymasterGasLimitMultiplier)

            paymasterVerificationGasLimit = scaleBigIntByPercent(
                paymasterVerificationGasLimit,
                multiplier
            )

            paymasterPostOpGasLimit = scaleBigIntByPercent(
                paymasterPostOpGasLimit,
                multiplier
            )
        }

        if (
            this.config.publicClient.chain.id === base.id ||
            this.config.publicClient.chain.id === baseSepolia.id
        ) {
            callGasLimit += 10_000n
        }

        if (
            this.config.publicClient.chain.id === base.id ||
            this.config.publicClient.chain.id === optimism.id
        ) {
            callGasLimit = maxBigInt(callGasLimit, 120_000n)
        }

        if (userOperation.callData === "0x") {
            callGasLimit = 0n
        }

        // If a balance override is provided for the sender, perform an additional simulation
        // to verify the userOperation succeeds with the specified balance.
        if (stateOverrides?.[userOperation.sender]?.balance) {
            await this.validator.getExecutionResult(
                {
                    ...userOperation,
                    preVerificationGas,
                    verificationGasLimit,
                    callGasLimit,
                    paymasterVerificationGasLimit,
                    paymasterPostOpGasLimit
                },
                entryPoint,
                queuedUserOperations,
                false,
                deepHexlify(stateOverrides)
            )
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
        const hash = getUserOperationHash(
            userOperation,
            entryPoint,
            this.config.publicClient.chain.id
        )
        this.eventManager.emitReceived(hash)

        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            status = await this.addToMempoolIfValid(
                userOperation,
                entryPoint,
                apiVersion
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

        let fromBlock: bigint | undefined
        let toBlock: "latest" | undefined
        if (this.rpcMaxBlockRange !== undefined) {
            const latestBlock = await this.config.publicClient.getBlockNumber()
            fromBlock = latestBlock - BigInt(this.rpcMaxBlockRange)
            if (fromBlock < 0n) {
                fromBlock = 0n
            }
            toBlock = "latest"
        }

        const filterResult = await this.config.publicClient.getLogs({
            address: this.config.entrypoints,
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
                return await this.config.publicClient.getTransaction({
                    hash: txHash
                })
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

        let op: UserOperationV06 | UserOperationV07
        try {
            const decoded = decodeFunctionData({
                abi: [...EntryPointV06Abi, ...EntryPointV07Abi],
                data: tx.input
            })

            if (decoded.functionName !== "handleOps") {
                return null
            }

            const ops = decoded.args[0]
            const foundOp = ops.find(
                (op: UserOperationV06 | PackedUserOperation) =>
                    op.sender === userOperationEvent.args.sender &&
                    op.nonce === userOperationEvent.args.nonce
            )

            if (foundOp === undefined) {
                return null
            }

            const handleOpsV07AbiItem = getAbiItem({
                abi: EntryPointV07Abi,
                name: "handleOps"
            })
            const handleOpsV07Selector = toFunctionSelector(handleOpsV07AbiItem)

            if (slice(tx.input, 0, 4) === handleOpsV07Selector) {
                op = toUnpackedUserOperation(foundOp as PackedUserOperation)
            } else {
                op = foundOp as UserOperationV06
            }
        } catch {
            return null
        }

        const result: GetUserOperationByHashResponseResult = {
            userOperation: op,
            entryPoint: getAddress(tx.to),
            transactionHash: txHash,
            blockHash: tx.blockHash ?? "0x",
            blockNumber: BigInt(tx.blockNumber ?? 0n)
        }

        return result
    }

    eth_getUserOperationReceipt(
        userOperationHash: HexData32
    ): Promise<GetUserOperationReceiptResponseResult> {
        return this.executorManager.getUserOperationReceipt(userOperationHash)
    }

    debug_bundler_clearState(): BundlerClearStateResponseResult {
        this.ensureDebugEndpointsAreEnabled("debug_bundler_clearState")

        this.mempool.clear()
        this.reputationManager.clear()
        return "ok"
    }

    debug_bundler_clearMempool(): BundlerClearMempoolResponseResult {
        this.ensureDebugEndpointsAreEnabled("debug_bundler_clearMempool")

        this.mempool.clear()
        this.reputationManager.clearEntityCount()
        return "ok"
    }

    async debug_bundler_dumpMempool(
        entryPoint: Address
    ): Promise<BundlerDumpMempoolResponseResult> {
        this.ensureDebugEndpointsAreEnabled("debug_bundler_dumpMempool")
        this.ensureEntryPointIsSupported(entryPoint)

        return this.mempool
            .dumpOutstanding()
            .map((userOpInfo) =>
                deriveUserOperation(userOpInfo.mempoolUserOperation)
            )
    }

    async debug_bundler_sendBundleNow(): Promise<BundlerSendBundleNowResponseResult> {
        this.ensureDebugEndpointsAreEnabled("debug_bundler_sendBundleNow")

        const transactions = await this.executorManager.bundleNow()
        return transactions[0]
    }

    debug_bundler_setBundlingMode(
        bundlingMode: BundlingMode
    ): BundlerSetBundlingModeResponseResult {
        this.ensureDebugEndpointsAreEnabled("debug_bundler_setBundlingMode")

        this.executorManager.setBundlingMode(bundlingMode)
        return "ok"
    }

    debug_bundler_dumpReputation(
        entryPoint: Address
    ): BundlerDumpReputationsResponseResult {
        this.ensureDebugEndpointsAreEnabled("debug_bundler_setReputation")
        this.ensureEntryPointIsSupported(entryPoint)

        return this.reputationManager.dumpReputations(entryPoint)
    }

    async debug_bundler_getStakeStatus(
        address: Address,
        entryPoint: Address
    ): Promise<BundlerGetStakeStatusResponseResult> {
        this.ensureDebugEndpointsAreEnabled("debug_bundler_getStakeStatus")
        this.ensureEntryPointIsSupported(entryPoint)

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
        this.ensureDebugEndpointsAreEnabled("debug_bundler_setReputation")

        this.reputationManager.setReputation(args[1], args[0])
        return "ok"
    }

    pimlico_getUserOperationStatus(
        userOperationHash: HexData32
    ): PimlicoGetUserOperationStatusResponseResult {
        return this.monitor.getUserOperationStatus(userOperationHash)
    }

    async pimlico_getUserOperationGasPrice(): Promise<PimlicoGetUserOperationGasPriceResponseResult> {
        let { maxFeePerGas, maxPriorityFeePerGas } =
            await this.gasPriceManager.getGasPrice()

        if (this.config.chainType === "hedera") {
            maxFeePerGas /= 10n ** 9n
            maxPriorityFeePerGas /= 10n ** 9n
        }

        const { slow, standard, fast } = this.config.gasPriceMultipliers

        return {
            slow: {
                maxFeePerGas: (maxFeePerGas * slow) / 100n,
                maxPriorityFeePerGas: (maxPriorityFeePerGas * slow) / 100n
            },
            standard: {
                maxFeePerGas: (maxFeePerGas * standard) / 100n,
                maxPriorityFeePerGas: (maxPriorityFeePerGas * standard) / 100n
            },
            fast: {
                maxFeePerGas: (maxFeePerGas * fast) / 100n,
                maxPriorityFeePerGas: (maxPriorityFeePerGas * fast) / 100n
            }
        }
    }

    // check if we want to bundle userOperation. If yes, add to mempool
    async addToMempoolIfValid(
        op: MempoolUserOperation,
        entryPoint: Address,
        apiVersion: ApiVersion
    ): Promise<"added" | "queued"> {
        this.ensureEntryPointIsSupported(entryPoint)

        const userOperation = deriveUserOperation(op)
        const opHash = getUserOperationHash(
            userOperation,
            entryPoint,
            this.config.publicClient.chain.id
        )

        await this.preMempoolChecks(
            opHash,
            userOperation,
            apiVersion,
            entryPoint
        )

        const currentNonceValue = await this.getNonceValue(
            userOperation,
            entryPoint
        )
        const [, userOperationNonceValue] = getNonceKeyAndValue(
            userOperation.nonce
        )

        if (userOperationNonceValue < currentNonceValue) {
            const reason =
                "UserOperation failed validation with reason: AA25 invalid account nonce"
            this.eventManager.emitFailedValidation(opHash, reason, "AA25")
            throw new RpcError(reason, ValidationErrors.InvalidFields)
        }
        if (userOperationNonceValue > currentNonceValue + 10n) {
            const reason =
                "UserOperation failed validaiton with reason: AA25 invalid account nonce"
            this.eventManager.emitFailedValidation(opHash, reason, "AA25")
            throw new RpcError(reason, ValidationErrors.InvalidFields)
        }

        let queuedUserOperations: UserOperation[] = []
        if (
            userOperationNonceValue > currentNonceValue &&
            isVersion07(userOperation)
        ) {
            queuedUserOperations = await this.mempool.getQueuedUserOperations(
                userOperation,
                entryPoint,
                currentNonceValue
            )
        }

        if (
            userOperationNonceValue ===
            currentNonceValue + BigInt(queuedUserOperations.length)
        ) {
            if (this.config.dangerousSkipUserOperationValidation) {
                const [success, errorReason] = this.mempool.add(op, entryPoint)
                if (!success) {
                    this.eventManager.emitFailedValidation(
                        opHash,
                        errorReason,
                        getAAError(errorReason)
                    )
                    throw new RpcError(
                        `UserOperation reverted during simulation with reason: ${errorReason}`,
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
                        queuedUserOperations,
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

                const [success, errorReason] = this.mempool.add(
                    op,
                    entryPoint,
                    validationResult.referencedContracts
                )

                if (!success) {
                    this.eventManager.emitFailedValidation(
                        opHash,
                        errorReason,
                        getAAError(errorReason)
                    )
                    throw new RpcError(
                        `UserOperation reverted during simulation with reason: ${errorReason}`,
                        ValidationErrors.InvalidFields
                    )
                }
                return "added"
            }
        }

        this.nonceQueuer.add(op, entryPoint)
        return "queued"
    }

    async pimlico_sendUserOperationNow(
        apiVersion: ApiVersion,
        userOperation: UserOperation,
        entryPoint: Address
    ) {
        if (!this.config.enableInstantBundlingEndpoint) {
            throw new RpcError(
                "pimlico_sendUserOperationNow endpoint is not enabled",
                ValidationErrors.InvalidFields
            )
        }

        this.ensureEntryPointIsSupported(entryPoint)

        const opHash = getUserOperationHash(
            userOperation,
            entryPoint,
            this.config.publicClient.chain.id
        )

        await this.preMempoolChecks(
            opHash,
            userOperation,
            apiVersion,
            entryPoint
        )

        const result = (
            await this.executor.bundle(entryPoint, [userOperation])
        )[0]

        if (result.status === "failure") {
            const { userOpHash, reason } = result.error
            this.monitor.setUserOperationStatus(userOpHash, {
                status: "rejected",
                transactionHash: null
            })
            this.logger.warn(
                {
                    userOperation: JSON.stringify(
                        result.error.userOperation,
                        (_k, v) => (typeof v === "bigint" ? v.toString() : v)
                    ),
                    userOpHash,
                    reason
                },
                "user operation rejected"
            )
            this.metrics.userOperationsSubmitted
                .labels({ status: "failed" })
                .inc()

            const { error } = result
            throw new RpcError(
                `userOperation reverted during simulation with reason: ${error.reason}`
            )
        }

        const res = result as unknown as {
            status: "success"
            value: {
                userOperation: UserOperationInfo
                transactionInfo: TransactionInfo
            }
        }

        this.executor.markWalletProcessed(res.value.transactionInfo.executor)

        // wait for receipt
        const receipt =
            await this.config.publicClient.waitForTransactionReceipt({
                hash: res.value.transactionInfo.transactionHash,
                pollingInterval: 100
            })

        const userOperationReceipt = parseUserOperationReceipt(opHash, receipt)

        return userOperationReceipt
    }

    async pimlico_sendCompressedUserOperation(
        apiVersion: ApiVersion,
        compressedCalldata: Hex,
        inflatorAddress: Address,
        entryPoint: Address
    ) {
        const receivedTimestamp = Date.now()
        let status: "added" | "queued" | "rejected" = "rejected"
        try {
            const { inflatedOp, inflatorId } =
                await this.validateAndInflateCompressedUserOperation(
                    inflatorAddress,
                    compressedCalldata
                )

            const hash = getUserOperationHash(
                inflatedOp,
                entryPoint,
                this.config.publicClient.chain.id
            )

            this.eventManager.emitReceived(hash, receivedTimestamp)

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
                this.config.publicClient
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
                public: this.config.publicClient
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

    async getNonceValue(userOperation: UserOperation, entryPoint: Address) {
        const entryPointContract = getContract({
            address: entryPoint,
            abi: isVersion06(userOperation)
                ? EntryPointV06Abi
                : EntryPointV07Abi,
            client: {
                public: this.config.publicClient
            }
        })

        const [nonceKey] = getNonceKeyAndValue(userOperation.nonce)

        const getNonceResult = await entryPointContract.read.getNonce(
            [userOperation.sender, nonceKey],
            {
                blockTag: "latest"
            }
        )

        const [_, currentNonceValue] = getNonceKeyAndValue(getNonceResult)

        return currentNonceValue
    }
}
