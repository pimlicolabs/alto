import { RpcHandlerConfig } from "@alto/config"
import { IExecutor } from "@alto/executor"
import { Monitor } from "@alto/executor/"
import {
    Address,
    BundlerClearStateResponseResult,
    BundlerDumpMempoolResponseResult,
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
    PimlicoGetUserOperationStatusResponseResult,
    RpcError,
    SendUserOperationResponseResult,
    SupportedEntryPointsResponseResult,
    UserOperation,
    logSchema,
    receiptSchema
} from "@alto/types"
import { Logger, calcPreVerificationGas } from "@alto/utils"
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

        // Runs a simulation to get a gas breakdown; if user operation reverts, an `RpcError` is thrown
        const executionResult = await this.validator.getExecutionResult(userOperation)

        const preVerificationGas = BigInt(calcPreVerificationGas(userOperation))
        const verificationGas = BigInt(executionResult.preOpGas)
        const calculatedCallGasLimit =
            executionResult.paid / userOperation.maxFeePerGas - executionResult.preOpGas + 21000n

        const callGasLimit = calculatedCallGasLimit > 9000n ? calculatedCallGasLimit : 9000n

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

        this.logger.trace({ userOperation, entryPoint }, "beginning validation")

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


        let fromBlock: bigint
        if (this.config.usingTenderly) {
            const latestBlock = await this.config.publicClient.getBlockNumber()
            fromBlock = latestBlock - 100n
        } else {
            fromBlock = 0n
        }
        
        // Look through logs to find the user operation
        const filterResult = await this.config.publicClient.getLogs({
            address: this.config.entryPoint,
            event: userOperationEventAbiItem,
            fromBlock,
            toBlock: "latest",
            args: {
                userOpHash: userOperationHash
            }
        })

        // If no corresponding log, user operation can't be found
        if (filterResult.length === 0) {
            return null
        }

        // Get user operation and prepare to query for transaction with user operation
        const userOperationEvent = filterResult[0]
        const txHash = userOperationEvent.transactionHash

        // If transaction hash is null, then the transaction is still pending
        if (txHash === null) {
            return null
        }

        // With tx hash defined, fetch encompassing tx of the user operation
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

        // Get transaction and decode the function data
        const tx = await getTransaction(txHash)
        const decoded = decodeFunctionData({ abi: EntryPointAbi, data: tx.input })
        if (decoded.functionName !== "handleOps") {
            return null
        }

        // With all user operations within the tx decoded, find the user operation
        const ops = decoded.args[0]
        const op = ops.find(
            (op: UserOperation) =>
                op.sender === userOperationEvent.args.sender && op.nonce === userOperationEvent.args.nonce
        )

        if (op === undefined) {
            return null
        }

        // Wrap user operation details into needed format
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

        let fromBlock: bigint
        if (this.config.usingTenderly) {
            const latestBlock = await this.config.publicClient.getBlockNumber()
            fromBlock = latestBlock - 100n
        } else {
            fromBlock = 0n
        }

        // Look through logs to find the user operation
        const filterResult = await this.config.publicClient.getLogs({
            address: this.config.entryPoint,
            event: userOperationEventAbiItem,
            fromBlock,
            toBlock: "latest",
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

        // If transaction hash is null, then the transaction is still pending
        const txHash = userOperationEvent.transactionHash
        if (txHash === null) {
            return null
        }

        // With tx hash defined, fetch the tx receipt of the encompassing tx of the user operation
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

        // Get receipt and extract logs
        const receipt = await getTransactionReceipt(txHash)
        const logs = receipt.logs

        // If a log has not been processed fully, it is very likely that transaction is pending
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
            return null
        }

        // Find the logs relevant to our user operation. Given that the EVM is single-threaded,
        // user operations and their respective logs will follow causal ordering i.e some array
        // of logs caused by operations e.g [op1, op1, op2, op2, op2, op3], find logs for opX etc.
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

        // Get logs that were caused by our user operation
        const filteredLogs = logs.slice(startIndex + 1, endIndex)

        // Parse and format each log
        const logsParsing = z.array(logSchema).safeParse(filteredLogs)
        if (!logsParsing.success) {
            const err = fromZodError(logsParsing.error)
            throw err
        }

        // Parse logs into a receipt format
        const receiptParsing = receiptSchema.safeParse({
            ...receipt,
            status: receipt.status === "success" ? 1 : 0
        })
        if (!receiptParsing.success) {
            const err = fromZodError(receiptParsing.error)
            throw err
        }

        // Wrap user operation receipt into needed format
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
}
