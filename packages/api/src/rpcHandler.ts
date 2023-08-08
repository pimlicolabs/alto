import { RpcHandlerConfig } from "@alto/config"
import { IExecutor } from "@alto/executor"
import { Monitor, getGasPrice } from "@alto/executor/"
import {
    Address,
    BundlerClearStateResponseResult,
    BundlerDumpMempoolResponseResult,
    BundlerFlushStuckTransactionsResponseResult,
    BundlerRequest,
    BundlerResponse,
    BundlerSendBundleNowResponseResult,
    BundlerSetBundlingModeResponseResult,
    BundlingMode,
    ChainIdResponseResult,
    EntryPointAbi,
    EstimateUserOperationGasResponseResult,
    GetUserOperationByHashResponseResult,
    GetUserOperationReceiptResponseResult,
    HexData32,
    PimlicoGetUserOperationGasPriceResponseResult,
    PimlicoGetUserOperationStatusResponseResult,
    RpcError,
    SendUserOperationResponseResult,
    SupportedEntryPointsResponseResult,
    UserOperation,
    logSchema,
    receiptSchema
} from "@alto/types"
import { Logger, calcPreVerificationGas, calcOptimismPreVerificationGas } from "@alto/utils"
import { IValidator } from "@alto/validator"
import {
    decodeFunctionData,
    getAbiItem,
    getContract,
    TransactionNotFoundError,
    TransactionReceiptNotFoundError,
    Transaction,
    TransactionReceipt
} from "viem"
import { z } from "zod"
import { fromZodError } from "zod-validation-error"

export interface IRpcEndpoint {
    handleMethod(request: BundlerRequest): Promise<BundlerResponse>
    eth_chainId(): Promise<ChainIdResponseResult>
    eth_supportedEntryPoints(): Promise<SupportedEntryPointsResponseResult>
    eth_estimateUserOperationGas(
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<EstimateUserOperationGasResponseResult>
    eth_sendUserOperation(userOperation: UserOperation, entryPoint: Address): Promise<SendUserOperationResponseResult>
    eth_getUserOperationByHash(userOperationHash: HexData32): Promise<GetUserOperationByHashResponseResult>
    eth_getUserOperationReceipt(userOperationHash: HexData32): Promise<GetUserOperationReceiptResponseResult>
}

export class RpcHandler implements IRpcEndpoint {
    config: RpcHandlerConfig
    validator: IValidator
    executor: IExecutor
    monitor: Monitor
    logger: Logger

    constructor(
        config: RpcHandlerConfig,
        validator: IValidator,
        executor: IExecutor,
        monitor: Monitor,
        logger: Logger
    ) {
        this.config = config
        this.validator = validator
        this.executor = executor
        this.monitor = monitor
        this.logger = logger
    }

    async handleMethod(request: BundlerRequest): Promise<BundlerResponse> {
        // call the method with the params
        const method = request.method
        switch (method) {
            case "eth_chainId":
                return { method, result: await this.eth_chainId(...request.params) }
            case "eth_supportedEntryPoints":
                return {
                    method,
                    result: await this.eth_supportedEntryPoints(...request.params)
                }
            case "eth_estimateUserOperationGas":
                return {
                    method,
                    result: await this.eth_estimateUserOperationGas(...request.params)
                }
            case "eth_sendUserOperation":
                return {
                    method,
                    result: await this.eth_sendUserOperation(...request.params)
                }
            case "eth_getUserOperationByHash":
                return {
                    method,
                    result: await this.eth_getUserOperationByHash(...request.params)
                }
            case "eth_getUserOperationReceipt":
                return {
                    method,
                    result: await this.eth_getUserOperationReceipt(...request.params)
                }
            case "debug_bundler_clearState":
                return {
                    method,
                    result: await this.debug_bundler_clearState(...request.params)
                }
            case "debug_bundler_dumpMempool":
                return {
                    method,
                    result: await this.debug_bundler_dumpMempool(...request.params)
                }
            case "debug_bundler_sendBundleNow":
                return {
                    method,
                    result: await this.debug_bundler_sendBundleNow(...request.params)
                }
            case "debug_bundler_setBundlingMode":
                return {
                    method,
                    result: await this.debug_bundler_setBundlingMode(...request.params)
                }
            case "pimlico_getUserOperationStatus":
                return {
                    method,
                    result: await this.pimlico_getUserOperationStatus(...request.params)
                }
            case "pimlico_getUserOperationGasPrice":
                return {
                    method,
                    result: await this.pimlico_getUserOperationGasPrice(...request.params)
                }
            case "debug_bundler_flushStuckTransactions":
                return {
                    method,
                    result: await this.debug_bundler_flushStuckTransactions(...request.params)
                }
        }
    }

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async eth_chainId(): Promise<ChainIdResponseResult> {
        return BigInt(this.config.chainId)
    }

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async eth_supportedEntryPoints(): Promise<SupportedEntryPointsResponseResult> {
        return [this.config.entryPoint]
    }

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async eth_estimateUserOperationGas(
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<EstimateUserOperationGasResponseResult> {
        // check if entryPoint is supported, if not throw
        if (this.config.entryPoint !== entryPoint) {
            throw new Error(`EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.config.entryPoint}`)
        }

        if (userOperation.maxFeePerGas === 0n) {
            throw new RpcError("user operation max fee per gas must be larger than 0 during gas estimation")
        }

        userOperation.preVerificationGas = 1_000_000n
        userOperation.verificationGasLimit = 10_000_000n
        userOperation.callGasLimit = 10_000_000n

        const executionResult = await this.validator.getExecutionResult(userOperation)

        let preVerificationGas = calcPreVerificationGas(userOperation)

        const verificationGas = ((executionResult.preOpGas - userOperation.preVerificationGas) * 3n) / 2n
        const calculatedCallGasLimit =
            executionResult.paid / userOperation.maxFeePerGas - executionResult.preOpGas + 21000n + 100000n

        const callGasLimit = calculatedCallGasLimit > 9000n ? calculatedCallGasLimit : 9000n

        if (this.config.chainId === 59140 || this.config.chainId === 59142) {
            preVerificationGas = preVerificationGas + (verificationGas + callGasLimit) / 3n
        } else if (this.config.chainId === 10 || this.config.chainId === 420 || this.config.chainId === 8453) {
            preVerificationGas = await calcOptimismPreVerificationGas(
                // @ts-ignore
                this.config.publicClient,
                userOperation,
                entryPoint,
                preVerificationGas
            )
        }

        return {
            preVerificationGas,
            verificationGas,
            verificationGasLimit: verificationGas,
            callGasLimit
        }
    }

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async eth_sendUserOperation(
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<SendUserOperationResponseResult> {
        if (this.config.entryPoint !== entryPoint) {
            throw new Error(`EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.config.entryPoint}`)
        }

        if (this.config.chainId === 44787 || this.config.chainId === 42220) {
            if (userOperation.maxFeePerGas !== userOperation.maxPriorityFeePerGas) {
                throw new RpcError("maxPriorityFeePerGas must equal maxFeePerGas on Celo chains")
            }
        }

        if (userOperation.verificationGasLimit < 10000n) {
            throw new RpcError("verificationGasLimit must be at least 10000")
        }

        this.logger.trace({ userOperation, entryPoint }, "beginning validation")

        if (
            userOperation.preVerificationGas === 0n ||
            userOperation.verificationGasLimit === 0n ||
            userOperation.callGasLimit === 0n
        ) {
            throw new RpcError("user operation gas limits must be larger than 0")
        }

        await this.validator.validateUserOperation(userOperation)

        this.logger.trace({ userOperation, entryPoint }, "beginning execution")

        await this.executor.bundle(entryPoint, userOperation)

        const entryPointContract = getContract({
            address: entryPoint,
            abi: EntryPointAbi,
            publicClient: this.config.publicClient
        })

        return await entryPointContract.read.getUserOpHash([userOperation])
    }

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async eth_getUserOperationByHash(userOperationHash: HexData32): Promise<GetUserOperationByHashResponseResult> {
        const userOperationEventAbiItem = getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" })

        // Only query up to the last `fullBlockRange` = 20000 blocks
        const latestBlock = await this.config.publicClient.getBlockNumber()
        let fullBlockRange = 20000n
        if (this.config.chainId === 335 || this.config.chainId === 8453) {
            fullBlockRange = 2000n
        }

        let fromBlock: bigint
        if (this.config.usingTenderly) {
            fromBlock = latestBlock - 100n
        } else {
            fromBlock = latestBlock - fullBlockRange
        }

        const filterResult = await this.config.publicClient.getLogs({
            address: this.config.entryPoint,
            event: userOperationEventAbiItem,
            fromBlock: fromBlock > 0n ? fromBlock : 0n,
            toBlock: latestBlock,
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

        const getTransaction = async (txHash: HexData32): Promise<Transaction> => {
            try {
                return await this.config.publicClient.getTransaction({ hash: txHash })
            } catch (e) {
                if (e instanceof TransactionNotFoundError) {
                    return getTransaction(txHash)
                } else {
                    throw e
                }
            }
        }

        const tx = await getTransaction(txHash)
        let op: any = undefined
        try {
            const decoded = decodeFunctionData({ abi: EntryPointAbi, data: tx.input })
            if (decoded.functionName !== "handleOps") {
                return null
            }
            const ops = decoded.args[0]
            op = ops.find(
                (op: UserOperation) =>
                    op.sender === userOperationEvent.args.sender && op.nonce === userOperationEvent.args.nonce
            )
        } catch {
            return null
        }

        if (op === undefined) {
            return null
        }

        const result: GetUserOperationByHashResponseResult = {
            userOperation: op,
            entryPoint: this.config.entryPoint,
            transactionHash: txHash,
            blockHash: tx.blockHash ?? "0x",
            blockNumber: BigInt(tx.blockNumber ?? 0n)
        }

        return result
    }

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async eth_getUserOperationReceipt(userOperationHash: HexData32): Promise<GetUserOperationReceiptResponseResult> {
        const userOperationEventAbiItem = getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" })

        // Only query up to the last `fullBlockRange` = 20000 blocks
        const latestBlock = await this.config.publicClient.getBlockNumber()
        let fullBlockRange = 20000n
        if (this.config.chainId === 335 || this.config.chainId === 8453) {
            fullBlockRange = 2000n
        }

        let fromBlock: bigint
        if (this.config.usingTenderly) {
            fromBlock = latestBlock - 100n
        } else {
            fromBlock = latestBlock - fullBlockRange
        }

        const filterResult = await this.config.publicClient.getLogs({
            address: this.config.entryPoint,
            event: userOperationEventAbiItem,
            fromBlock: fromBlock > 0n ? fromBlock : 0n,
            toBlock: latestBlock,
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

        const getTransactionReceipt = async (txHash: HexData32): Promise<TransactionReceipt> => {
            try {
                return await this.config.publicClient.getTransactionReceipt({ hash: txHash })
            } catch (e) {
                if (e instanceof TransactionReceiptNotFoundError) {
                    return getTransactionReceipt(txHash)
                } else {
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

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async debug_bundler_clearState(): Promise<BundlerClearStateResponseResult> {
        throw new Error("Method not implemented.")
    }

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async debug_bundler_dumpMempool(_entryPoint: Address): Promise<BundlerDumpMempoolResponseResult> {
        throw new Error("Method not implemented.")
    }

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async debug_bundler_sendBundleNow(): Promise<BundlerSendBundleNowResponseResult> {
        throw new Error("Method not implemented.")
    }

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async debug_bundler_setBundlingMode(_bundlingMode: BundlingMode): Promise<BundlerSetBundlingModeResponseResult> {
        throw new Error("Method not implemented.")
    }

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async pimlico_getUserOperationStatus(
        userOperationHash: HexData32
    ): Promise<PimlicoGetUserOperationStatusResponseResult> {
        return this.monitor.getUserOperationStatus(userOperationHash)
    }

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async pimlico_getUserOperationGasPrice(): Promise<PimlicoGetUserOperationGasPriceResponseResult> {
        const gasPrice = await getGasPrice(this.config.chainId, this.config.publicClient, this.logger)
        return {
            slow: {
                maxFeePerGas: (gasPrice.maxFeePerGas * 105n) / 100n,
                maxPriorityFeePerGas: (gasPrice.maxPriorityFeePerGas * 105n) / 100n
            },
            standard: {
                maxFeePerGas: (gasPrice.maxFeePerGas * 110n) / 100n,
                maxPriorityFeePerGas: (gasPrice.maxPriorityFeePerGas * 110n) / 100n
            },
            fast: {
                maxFeePerGas: (gasPrice.maxFeePerGas * 115n) / 100n,
                maxPriorityFeePerGas: (gasPrice.maxPriorityFeePerGas * 115n) / 100n
            }
        }
    }

    // rome-ignore lint/nursery/useCamelCase: <explanation>
    async debug_bundler_flushStuckTransactions(): Promise<BundlerFlushStuckTransactionsResponseResult> {
        await this.executor.flushStuckTransactions()

        return "ok"
    }
}
