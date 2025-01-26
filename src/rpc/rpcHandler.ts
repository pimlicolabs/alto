import type { Executor, ExecutorManager } from "@alto/executor"
import type { EventManager, GasPriceManager } from "@alto/handlers"
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
    EntryPointV06Abi,
    EntryPointV07Abi,
    type EstimateUserOperationGasResponseResult,
    type GetUserOperationByHashResponseResult,
    type GetUserOperationReceiptResponseResult,
    type HexData32,
    type InterfaceValidator,
    type PimlicoGetUserOperationGasPriceResponseResult,
    type PimlicoGetUserOperationStatusResponseResult,
    RpcError,
    type SendUserOperationResponseResult,
    type SupportedEntryPointsResponseResult,
    type UserOperation,
    ValidationErrors,
    bundlerGetStakeStatusResponseSchema
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
    logger: Logger
    metrics: Metrics
    executorManager: ExecutorManager
    reputationManager: InterfaceReputationManager
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
                    result: await this.debug_bundler_setBundlingMode(
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
            case "pimlico_sendUserOperationNow":
                return {
                    method,
                    result: await this.pimlico_sendUserOperationNow(
                        apiVersion,
                        ...request.params
                    )
                }
            case "pimlico_experimental_sendUserOperation7702":
                return {
                    method,
                    result: await this.pimlico_experimental_sendUserOperation7702(
                        apiVersion,
                        ...request.params
                    )
                }
            case "pimlico_experimental_estimateUserOperationGas7702":
                return {
                    method,
                    result: await this.pimlico_experimental_estimateUserOperationGas7702(
                        apiVersion,
                        request.params[0],
                        request.params[1],
                        request.params[2]
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

        if (isVersion07(userOperation)) {
            const gasLimits =
                userOperation.callGasLimit +
                userOperation.verificationGasLimit +
                (userOperation.paymasterPostOpGasLimit ?? 0n) +
                (userOperation.paymasterVerificationGasLimit ?? 0n)

            if (gasLimits > this.config.maxGasPerBundle) {
                throw new RpcError(
                    `User operation gas limits exceed the max gas per bundle: ${gasLimits} > ${this.config.maxGasPerBundle}`
                )
            }
        }

        if (isVersion06(userOperation)) {
            const gasLimits =
                userOperation.callGasLimit + userOperation.verificationGasLimit

            const maxGasPerBundle = (this.config.maxGasPerBundle * 130n) / 100n

            if (gasLimits > maxGasPerBundle) {
                throw new RpcError(
                    `User operation gas limits exceed the max gas per bundle: ${gasLimits} > ${this.config.maxGasPerBundle}`
                )
            }
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
        return await this.estimateGas({
            apiVersion,
            userOperation,
            entryPoint,
            stateOverrides
        })
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
        if (this.config.maxBlockRange !== undefined) {
            const latestBlock = await this.config.publicClient.getBlockNumber()
            fromBlock = latestBlock - BigInt(this.config.maxBlockRange)
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
            .map(({ userOperation }) => userOperation)
    }

    async debug_bundler_sendBundleNow(): Promise<BundlerSendBundleNowResponseResult> {
        this.ensureDebugEndpointsAreEnabled("debug_bundler_sendBundleNow")
        const transaction = await this.executorManager.sendBundleNow()
        return transaction
    }

    async debug_bundler_setBundlingMode(
        bundlingMode: BundlingMode
    ): Promise<BundlerSetBundlingModeResponseResult> {
        this.ensureDebugEndpointsAreEnabled("debug_bundler_setBundlingMode")

        await this.executorManager.setBundlingMode(bundlingMode)
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
        userOperation: UserOperation,
        entryPoint: Address,
        apiVersion: ApiVersion
    ): Promise<"added" | "queued"> {
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
            userOperationNonceValue >
            currentNonceValue + BigInt(queuedUserOperations.length)
        ) {
            this.nonceQueuer.add(userOperation, entryPoint)
            return "queued"
        }

        if (this.config.dangerousSkipUserOperationValidation) {
            const [success, errorReason] = this.mempool.add(
                userOperation,
                entryPoint
            )
            if (!success) {
                this.eventManager.emitFailedValidation(
                    opHash,
                    errorReason,
                    getAAError(errorReason)
                )
                throw new RpcError(errorReason, ValidationErrors.InvalidFields)
            }
            return "added"
        }

        if (apiVersion !== "v1") {
            await this.validator.validatePreVerificationGas({
                userOperation,
                entryPoint
            })
        }

        const validationResult = await this.validator.validateUserOperation({
            shouldCheckPrefund: apiVersion !== "v1",
            userOperation,
            queuedUserOperations,
            entryPoint
        })

        await this.reputationManager.checkReputation(
            userOperation,
            entryPoint,
            validationResult
        )

        await this.mempool.checkEntityMultipleRoleViolation(userOperation)

        const [success, errorReason] = this.mempool.add(
            userOperation,
            entryPoint,
            validationResult.referencedContracts
        )

        if (!success) {
            this.eventManager.emitFailedValidation(
                opHash,
                errorReason,
                getAAError(errorReason)
            )
            throw new RpcError(errorReason, ValidationErrors.InvalidFields)
        }
        return "added"
    }

    async pimlico_experimental_estimateUserOperationGas7702(
        apiVersion: ApiVersion,
        userOperation: UserOperation,
        entryPoint: Address,
        stateOverrides?: StateOverrides
    ) {
        if (!this.config.enableExperimental7702Endpoints) {
            throw new RpcError(
                "pimlico_experimental_estimateUserOperationGas7702 endpoint is not enabled",
                ValidationErrors.InvalidFields
            )
        }

        return await this.estimateGas({
            apiVersion,
            userOperation,
            entryPoint,
            stateOverrides
        })
    }

    async pimlico_experimental_sendUserOperation7702(
        apiVersion: ApiVersion,
        userOperation: UserOperation,
        entryPoint: Address
    ) {
        if (!this.config.enableExperimental7702Endpoints) {
            throw new RpcError(
                "pimlico_experimental_sendUserOperation7702 endpoint is not enabled",
                ValidationErrors.InvalidFields
            )
        }

        this.ensureEntryPointIsSupported(entryPoint)

        try {
            await this.addToMempoolIfValid(
                userOperation,
                entryPoint,
                apiVersion
            )
        } catch (e) {
            this.logger.error(e)
        }

        return getUserOperationHash(
            userOperation,
            entryPoint,
            this.config.publicClient.chain.id
        )
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

        const txSender = res.value.transactionInfo.executor.address
        this.executor.markWalletProcessed(txSender)

        // wait for receipt
        const receipt =
            await this.config.publicClient.waitForTransactionReceipt({
                hash: res.value.transactionInfo.transactionHash,
                pollingInterval: 100
            })

        const userOperationReceipt = parseUserOperationReceipt(opHash, receipt)

        return userOperationReceipt
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

    async estimateGas({
        apiVersion,
        userOperation,
        entryPoint,
        stateOverrides
    }: {
        apiVersion: ApiVersion
        userOperation: UserOperation
        entryPoint: Address
        stateOverrides?: StateOverrides
    }) {
        this.ensureEntryPointIsSupported(entryPoint)

        if (userOperation.maxFeePerGas === 0n) {
            throw new RpcError(
                "user operation max fee per gas must be larger than 0 during gas estimation"
            )
        }

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

        // Prepare userOperation for simulation
        const {
            simulationVerificationGasLimit,
            simulationCallGasLimit,
            simulationPaymasterVerificationGasLimit,
            simulationPaymasterPostOpGasLimit
        } = this.config

        const simulationUserOperation = {
            ...userOperation,
            preVerificationGas: 0n,
            verificationGasLimit: simulationVerificationGasLimit,
            callGasLimit: simulationCallGasLimit
        }

        if (isVersion07(simulationUserOperation)) {
            simulationUserOperation.paymasterVerificationGasLimit =
                simulationPaymasterVerificationGasLimit
            simulationUserOperation.paymasterPostOpGasLimit =
                simulationPaymasterPostOpGasLimit
        }

        // This is necessary because entryPoint pays
        // min(maxFeePerGas, baseFee + maxPriorityFeePerGas) for the verification
        // Since we don't want our estimations to depend upon baseFee, we set
        // maxFeePerGas to maxPriorityFeePerGas
        simulationUserOperation.maxPriorityFeePerGas =
            simulationUserOperation.maxFeePerGas

        const executionResult = await this.validator.getExecutionResult({
            userOperation: simulationUserOperation,
            entryPoint,
            queuedUserOperations,
            addSenderBalanceOverride: true,
            stateOverrides: deepHexlify(stateOverrides)
        })

        let {
            verificationGasLimit,
            callGasLimit,
            paymasterVerificationGasLimit
        } = calcVerificationGasAndCallGasLimit(
            simulationUserOperation,
            executionResult.data.executionResult,
            this.config.publicClient.chain.id,
            executionResult.data
        )

        let paymasterPostOpGasLimit = 0n

        if (
            !paymasterVerificationGasLimit &&
            isVersion07(simulationUserOperation) &&
            simulationUserOperation.paymaster !== null &&
            "paymasterVerificationGasLimit" in
                executionResult.data.executionResult
        ) {
            paymasterVerificationGasLimit =
                executionResult.data.executionResult
                    .paymasterVerificationGasLimit || 1n

            paymasterVerificationGasLimit = scaleBigIntByPercent(
                paymasterVerificationGasLimit,
                this.config.paymasterGasLimitMultiplier
            )
        }

        if (
            isVersion07(simulationUserOperation) &&
            simulationUserOperation.paymaster !== null &&
            "paymasterPostOpGasLimit" in executionResult.data.executionResult
        ) {
            paymasterPostOpGasLimit =
                executionResult.data.executionResult.paymasterPostOpGasLimit ||
                1n

            paymasterPostOpGasLimit = scaleBigIntByPercent(
                paymasterPostOpGasLimit,
                this.config.paymasterGasLimitMultiplier
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

        if (simulationUserOperation.callData === "0x") {
            callGasLimit = 0n
        }

        if (isVersion06(simulationUserOperation)) {
            callGasLimit = scaleBigIntByPercent(
                callGasLimit,
                this.config.v6CallGasLimitMultiplier
            )
        }

        if (isVersion07(simulationUserOperation)) {
            verificationGasLimit = scaleBigIntByPercent(
                verificationGasLimit,
                this.config.v7VerificationGasLimitMultiplier
            )
            paymasterVerificationGasLimit = scaleBigIntByPercent(
                paymasterVerificationGasLimit,
                this.config.v7PaymasterVerificationGasLimitMultiplier
            )
            callGasLimit = scaleBigIntByPercent(
                callGasLimit,
                this.config.v7CallGasLimitMultiplier
            )
        }

        let preVerificationGas = await calcPreVerificationGas({
            config: this.config,
            userOperation: {
                ...userOperation,
                callGasLimit, // use actual callGasLimit
                verificationGasLimit, // use actual verificationGasLimit
                paymasterPostOpGasLimit, // use actual paymasterPostOpGasLimit
                paymasterVerificationGasLimit // use actual paymasterVerificationGasLimit
            },
            entryPoint,
            gasPriceManager: this.gasPriceManager,
            validate: false
        })
        preVerificationGas = scaleBigIntByPercent(preVerificationGas, 110n)

        // Check if userOperation passes without estimation balance overrides
        if (isVersion06(simulationUserOperation)) {
            await this.validator.getExecutionResult({
                userOperation: {
                    ...simulationUserOperation,
                    preVerificationGas,
                    verificationGasLimit,
                    callGasLimit,
                    paymasterVerificationGasLimit,
                    paymasterPostOpGasLimit
                },
                entryPoint,
                queuedUserOperations,
                addSenderBalanceOverride: false,
                stateOverrides: deepHexlify(stateOverrides)
            })
        }

        if (isVersion07(simulationUserOperation)) {
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
}
