import {
    type Address,
    type ApiVersion,
    type BundleSend,
    ERC7769Errors,
    RpcError,
    type UserOpInfo,
    type UserOperation,
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
import type { FilterOpsResult } from "../../executor/filterOpsAndEstimateGas"
import { createMethodHandler } from "../createMethodHandler"
import type { RpcHandler } from "../rpcHandler"
import { getBoostedUserOpError } from "./boost_sendUserOperation"
import { addToMempoolIfValid } from "./eth_sendUserOperation"

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

// Records outcomes and rejects or queues the userOp for one instant send.
// Shared with pimlico_sendPreparedUserOperation.
export const createInstantSend = ({
    rpcHandler,
    userOp,
    entryPoint,
    apiVersion,
    isBoosted,
    requestStart
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    apiVersion: ApiVersion
    isBoosted: boolean
    requestStart: number
}) => {
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

    return { recordOutcome, reject, addToMempool }
}

type InstantSend = ReturnType<typeof createInstantSend>

// Zero gas fees make the userOp boosted: the bundler pays its gas, as with
// boost_sendUserOperation.
export const isBoostedUserOp = (userOp: UserOperation) =>
    userOp.maxFeePerGas === 0n && userOp.maxPriorityFeePerGas === 0n

// Checks the userOp's fields and gas price. Returns why it's invalid, if it
// is.
export const validateInstantUserOp = async ({
    rpcHandler,
    userOp,
    entryPoint,
    apiVersion,
    isBoosted
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
    apiVersion: ApiVersion
    isBoosted: boolean
}): Promise<string | undefined> => {
    // Validate userOp fields (sync - fail fast before expensive async checks)
    const [fieldsValid, fieldsError] = rpcHandler.validateUserOpFields({
        userOp,
        entryPoint,
        isBoosted
    })
    if (!fieldsValid) {
        return fieldsError
    }

    // Validate gas price (async)
    const [gasPriceValid, gasPriceError] =
        await rpcHandler.validateUserOpGasPrice({
            userOp,
            apiVersion,
            isBoosted
        })
    if (!gasPriceValid) {
        return gasPriceError
    }

    return undefined
}

// A bundle with just this userOp.
export const createInstantBundle = ({
    rpcHandler,
    userOp,
    entryPoint
}: {
    rpcHandler: RpcHandler
    userOp: UserOperation
    entryPoint: Address
}): UserOperationBundle => {
    const receivedAt = Date.now()
    const userOpInfo: UserOpInfo = {
        userOp,
        userOpHash: getUserOpHash({
            userOp,
            entryPointAddress: entryPoint,
            chainId: rpcHandler.config.chainId
        }),
        receivedAt,
        addedToMempool: receivedAt, // deprecated alias, see withReceivedAt
        submissionAttempts: 0
    }

    return {
        entryPoint,
        userOps: [userOpInfo],
        version: getViemEntryPointVersion(userOp, entryPoint),
        submissionAttempts: 0
    }
}

// Sends the bundle right away and waits for the userOp's receipt. The caller
// marks the userOp as processing first. With filterOpsResult the bundle isn't
// simulated again.
export const sendInstantBundle = async ({
    rpcHandler,
    bundle,
    filterOpsResult,
    requestStart,
    instantSend: { recordOutcome, reject, addToMempool }
}: {
    rpcHandler: RpcHandler
    bundle: UserOperationBundle
    filterOpsResult?: FilterOpsResult
    requestStart: number
    instantSend: InstantSend
}): Promise<UserOperationReceipt> => {
    const { metrics } = rpcHandler
    const { entryPoint, userOps } = bundle
    const { userOpHash } = userOps[0]
    const deadline = requestStart + rpcHandler.config.instantBundlingTimeout

    const sendStart = Date.now()
    const result = await rpcHandler.executorManager.sendBundleNow({
        userOpBundle: bundle,
        walletTimeoutMs: Math.max(
            0,
            Math.min(
                rpcHandler.config.instantBundlingExecutorWait,
                deadline - sendStart
            )
        ),
        filterOpsResult
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
            userOpInfos: userOps
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
        const [userOp, entryPoint] = params
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        const isBoosted = isBoostedUserOp(userOp)
        const instantSend = createInstantSend({
            rpcHandler,
            userOp,
            entryPoint,
            apiVersion,
            isBoosted,
            requestStart
        })

        if (isBoosted) {
            const boostedUserOpError = getBoostedUserOpError({ userOp })
            if (boostedUserOpError) {
                return instantSend.reject(boostedUserOpError)
            }
        }

        if (rpcHandler.config.skipInstantBundling) {
            return await instantSend.addToMempool("skip-instant-bundling")
        }

        const userOpError = await validateInstantUserOp({
            rpcHandler,
            userOp,
            entryPoint,
            apiVersion,
            isBoosted
        })
        if (userOpError) {
            return instantSend.reject(userOpError)
        }

        const bundle = createInstantBundle({ rpcHandler, userOp, entryPoint })
        rpcHandler.mempool.store.addProcessing({
            entryPoint,
            userOpInfos: bundle.userOps
        })

        return await sendInstantBundle({
            rpcHandler,
            bundle,
            requestStart,
            instantSend
        })
    }
})
