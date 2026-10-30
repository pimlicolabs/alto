import {
    type BundleSend,
    ERC7769Errors,
    RpcError,
    type UserOpInfo,
    type UserOperationBundle,
    type UserOperationReceipt,
    pimlicoSendUserOperationNowSchema
} from "@alto/types"
import {
    type InstantOutcome,
    getUserOpHash,
    getViemEntryPointVersion,
    observeDurationMs,
    parseUserOpReceipt
} from "@alto/utils"
import {
    BaseError,
    type Hex,
    type TransactionReceipt,
    TransactionReceiptNotFoundError
} from "viem"
import { createMethodHandler } from "../createMethodHandler"
import type { RpcHandler } from "../rpcHandler"
import { getBoostedUserOpError } from "./boost_sendUserOperation"
import {
    addToMempoolIfValid,
    validateMaxPvg,
    validateNoNestedUserOps
} from "./eth_sendUserOperation"

type ReceiptWaitResult =
    | { status: "included"; userOpReceipt: UserOperationReceipt }
    | { status: "reverted"; transactionHash: Hex }
    | { status: "timeout" }

// Resolves with whichever comes first: the eth_sendRawTransactionSync
// receipt, a receipt found by polling, or the deadline. Polling checks the
// receipt cache too, as the block loop may replace the transaction (gas
// bump) and the original hash never lands.
const waitForReceipt = ({
    rpcHandler,
    userOpHash,
    transactionHash,
    send,
    timeoutMs
}: {
    rpcHandler: RpcHandler
    userOpHash: Hex
    transactionHash: Hex
    send: BundleSend
    timeoutMs: number
}): Promise<ReceiptWaitResult> => {
    const { publicClient, blockTime } = rpcHandler.config
    const pollingInterval = Math.max(50, Math.min(100, blockTime / 4))

    const fromTransactionReceipt = (
        receipt: TransactionReceipt
    ): ReceiptWaitResult => {
        if (receipt.status === "reverted") {
            return {
                status: "reverted",
                transactionHash: receipt.transactionHash
            }
        }
        return {
            status: "included",
            userOpReceipt: parseUserOpReceipt(userOpHash, receipt)
        }
    }

    return new Promise((resolve) => {
        let settled = false
        let pollTimer: ReturnType<typeof setTimeout> | undefined

        const settle = (result: ReceiptWaitResult) => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(pollTimer)
            clearTimeout(deadlineTimer)
            resolve(result)
        }

        const deadlineTimer = setTimeout(
            () => settle({ status: "timeout" }),
            Math.max(0, timeoutMs)
        )

        // The sync receipt never rejects, but parsing it can throw. Polling
        // keeps going either way.
        if (send.method === "eth_sendRawTransactionSync") {
            send.receipt
                .then((receipt) => {
                    if (receipt) {
                        settle(fromTransactionReceipt(receipt))
                    }
                })
                .catch((err: unknown) => {
                    rpcHandler.logger.debug(
                        { err, userOpHash, txHash: transactionHash },
                        "failed to parse eth_sendRawTransactionSync receipt"
                    )
                })
        }

        const poll = async () => {
            if (settled) {
                return
            }

            try {
                const cachedUserOpReceipt =
                    await rpcHandler.bundleManager.getCachedUserOpReceipt(
                        userOpHash
                    )
                if (cachedUserOpReceipt) {
                    settle({
                        status: "included",
                        userOpReceipt: cachedUserOpReceipt
                    })
                    return
                }

                const receipt = await publicClient
                    .getTransactionReceipt({ hash: transactionHash })
                    .catch((err: unknown) => {
                        // Not mined yet.
                        if (
                            err instanceof BaseError &&
                            err.walk(
                                (e) =>
                                    e instanceof TransactionReceiptNotFoundError
                            )
                        ) {
                            return undefined
                        }
                        throw err
                    })
                if (receipt) {
                    settle(fromTransactionReceipt(receipt))
                    return
                }
            } catch (err) {
                rpcHandler.logger.debug(
                    { err, userOpHash, txHash: transactionHash },
                    "failed to poll for pimlico_sendUserOperationNow receipt"
                )
            }

            if (!settled) {
                pollTimer = setTimeout(poll, pollingInterval)
            }
        }

        pollTimer = setTimeout(poll, pollingInterval)
    })
}

export const pimlicoSendUserOperationNowHandler = createMethodHandler({
    method: "pimlico_sendUserOperationNow",
    schema: pimlicoSendUserOperationNowSchema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        if (!rpcHandler.config.enableInstantBundlingEndpoint) {
            throw new RpcError(
                "pimlico_sendUserOperationNow endpoint is not enabled",
                ERC7769Errors.InvalidFields
            )
        }

        const requestStart = Date.now()
        const deadline = requestStart + rpcHandler.config.instantBundlingTimeout
        const { metrics } = rpcHandler

        const recordOutcome = (outcome: InstantOutcome) => {
            metrics.instantOutcome.labels({ outcome }).inc()
            observeDurationMs({
                histogram: metrics.instantDuration.labels({ stage: "total" }),
                startMs: requestStart,
                endMs: Date.now()
            })
        }

        const reject = (message: string): never => {
            recordOutcome("rejected")
            throw new RpcError(message, ERC7769Errors.InvalidFields)
        }

        const [userOp, entryPoint] = params
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        // Zero gas fees make the userOp boosted: the bundler pays its gas, as
        // with boost_sendUserOperation.
        const isBoosted =
            userOp.maxFeePerGas === 0n && userOp.maxPriorityFeePerGas === 0n
        if (isBoosted) {
            const boostedUserOpError = getBoostedUserOpError({ userOp })
            if (boostedUserOpError) {
                return reject(boostedUserOpError)
            }
        }

        // Adds the userOp to the mempool like eth_sendUserOperation (with
        // full validation) and tells the client to track it.
        const addToMempool = async (reason: string): Promise<never> => {
            const { result, userOpHash } = await addToMempoolIfValid({
                rpcHandler,
                userOp,
                entryPoint,
                apiVersion,
                isBoosted
            }).catch((err: unknown) => {
                recordOutcome(err instanceof RpcError ? "rejected" : "failed")
                throw err
            })
            rpcHandler.eventManager.emitReceived(userOpHash)
            metrics.userOpsReceived
                .labels({
                    status: result,
                    type: userOp.eip7702Auth ? "7702" : "regular"
                })
                .inc()

            recordOutcome("queued")
            rpcHandler.logger.info(
                { userOpHash, reason },
                "pimlico_sendUserOperationNow added userOperation to the mempool"
            )
            throw new RpcError(
                "userOperation was added to the mempool. Track it with eth_getUserOperationReceipt",
                ERC7769Errors.InvalidFields,
                { userOpHash }
            )
        }

        if (rpcHandler.config.skipInstantBundling) {
            return await addToMempool("skip-instant-bundling")
        }

        // Validate userOp fields (sync - fail fast before expensive async checks)
        const [fieldsValid, fieldsError] = rpcHandler.validateUserOpFields({
            userOp,
            entryPoint,
            isBoosted
        })
        if (!fieldsValid) {
            return reject(fieldsError)
        }

        const userOpHash = getUserOpHash({
            userOp,
            entryPointAddress: entryPoint,
            chainId: rpcHandler.config.chainId
        })

        // Validate gas price, preVerificationGas and nested userOps (async)
        const [
            [gasPriceValid, gasPriceError],
            [isPvgBelowMax, maxPvgError],
            [isNestedUserOpsValid, nestedUserOpsError]
        ] = await Promise.all([
            rpcHandler.validateUserOpGasPrice({
                userOp,
                apiVersion,
                isBoosted
            }),
            validateMaxPvg({ rpcHandler, userOp, entryPoint, isBoosted }),
            validateNoNestedUserOps({
                rpcHandler,
                userOp,
                userOpHash,
                queuedUserOps: [],
                entryPoint
            })
        ])
        if (!gasPriceValid) {
            return reject(gasPriceError)
        }
        if (!isPvgBelowMax) {
            return reject(maxPvgError)
        }
        if (!isNestedUserOpsValid) {
            return reject(nestedUserOpsError)
        }

        // Prepare bundle
        const receivedAt = Date.now()
        const userOpInfo: UserOpInfo = {
            userOp,
            userOpHash,
            receivedAt,
            addedToMempool: receivedAt, // deprecated alias, see withReceivedAt
            submissionAttempts: 0
        }

        // Derive version.
        const version = getViemEntryPointVersion(userOp, entryPoint)

        const bundle: UserOperationBundle = {
            entryPoint,
            userOps: [userOpInfo],
            version,
            submissionAttempts: 0
        }
        rpcHandler.mempool.store.addProcessing({
            entryPoint,
            userOpInfos: [userOpInfo]
        })

        const sendStart = Date.now()
        const result = await rpcHandler.executorManager.sendBundleNow({
            userOpBundle: bundle,
            walletTimeoutMs: Math.max(
                0,
                Math.min(
                    rpcHandler.config.instantBundlingExecutorWait,
                    deadline - sendStart
                )
            )
        })
        observeDurationMs({
            histogram: metrics.instantDuration.labels({ stage: "send" }),
            startMs: sendStart,
            endMs: Date.now()
        })

        // No executor freed up in time.
        if (result && !result.success && result.status === "no_executor") {
            await rpcHandler.mempool.store.removeProcessing({
                entryPoint,
                userOpInfos: [userOpInfo]
            })
            return await addToMempool("no free executor")
        }

        // Failures on our side are server errors: the RPC server reports
        // non-RpcErrors to Sentry and logs them, and the client only gets a
        // generic message.
        if (!result || (!result.success && result.status === "error")) {
            recordOutcome("failed")
            rpcHandler.logger.error(
                { userOpHash, reason: result?.reason ?? "no bundle to send" },
                "pimlico_sendUserOperationNow failed to submit the bundle"
            )
            throw new Error("internal error while submitting the userOperation")
        }

        if (!result.success) {
            return reject(`bundle submission failed: ${result.reason}`)
        }

        const { transactionHash, send } = result

        const receiptStart = Date.now()
        const receiptResult = await waitForReceipt({
            rpcHandler,
            userOpHash,
            transactionHash,
            send,
            timeoutMs: deadline - receiptStart
        })
        observeDurationMs({
            histogram: metrics.instantDuration.labels({ stage: "receipt" }),
            startMs: receiptStart,
            endMs: Date.now()
        })

        if (receiptResult.status === "timeout") {
            recordOutcome("timeout")
            rpcHandler.logger.warn(
                { userOpHash, txHash: transactionHash },
                "pimlico_sendUserOperationNow timed out waiting for inclusion"
            )
            throw new RpcError(
                "userOperation was submitted but is not yet included. Track it with eth_getUserOperationReceipt",
                ERC7769Errors.InvalidFields,
                { userOpHash, transactionHash }
            )
        }

        if (receiptResult.status === "reverted") {
            recordOutcome("reverted")
            rpcHandler.logger.warn(
                { userOpHash, txHash: receiptResult.transactionHash },
                "pimlico_sendUserOperationNow bundle reverted"
            )
            throw new RpcError(
                `bundle transaction ${receiptResult.transactionHash} reverted onchain`,
                ERC7769Errors.UserOperationReverted,
                {
                    userOpHash,
                    transactionHash: receiptResult.transactionHash
                }
            )
        }

        recordOutcome("included")
        return receiptResult.userOpReceipt
    }
})
