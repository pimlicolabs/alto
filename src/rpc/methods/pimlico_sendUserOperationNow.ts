import {
    ERC7769Errors,
    RpcError,
    type UserOpInfo,
    type UserOperationBundle,
    type UserOperationReceipt,
    pimlicoSendUserOperationNowSchema
} from "@alto/types"
import {
    getUserOpHash,
    getViemEntryPointVersion,
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

type ReceiptWaitResult =
    | { status: "included"; userOpReceipt: UserOperationReceipt }
    | { status: "reverted"; transactionHash: Hex }
    | { status: "timeout" }

// Resolves with whichever comes first: the receipt seen while sending, a
// receipt found by polling, or the deadline. Polling checks the
// receipt cache too, as the block loop may replace the transaction (gas
// bump) and the original hash never lands.
const waitForReceipt = ({
    rpcHandler,
    userOpHash,
    transactionHash,
    sendReceipt,
    timeoutMs
}: {
    rpcHandler: RpcHandler
    userOpHash: Hex
    transactionHash: Hex
    sendReceipt: Promise<TransactionReceipt | undefined>
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

        // sendReceipt never rejects, but parsing the receipt can throw.
        // Polling keeps going either way.
        sendReceipt
            .then((receipt) => {
                if (receipt) {
                    settle(fromTransactionReceipt(receipt))
                }
            })
            .catch((err: unknown) => {
                rpcHandler.logger.debug(
                    { err, userOpHash, txHash: transactionHash },
                    "failed to parse pimlico_sendUserOperationNow send receipt"
                )
            })

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

        const deadline = Date.now() + rpcHandler.config.instantBundlingTimeout

        const [userOp, entryPoint] = params
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        // Validate userOp fields (sync - fail fast before expensive async checks)
        const [fieldsValid, fieldsError] = rpcHandler.validateUserOpFields({
            userOp,
            entryPoint
        })
        if (!fieldsValid) {
            throw new RpcError(fieldsError, ERC7769Errors.InvalidFields)
        }

        const userOpHash = getUserOpHash({
            userOp,
            entryPointAddress: entryPoint,
            chainId: rpcHandler.config.chainId
        })

        // Validate gas price (async)
        const [gasPriceValid, gasPriceError] =
            await rpcHandler.validateUserOpGasPrice({ userOp, apiVersion })
        if (!gasPriceValid) {
            throw new RpcError(gasPriceError, ERC7769Errors.InvalidFields)
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

        const result = await rpcHandler.executorManager.sendBundleNow(bundle)

        if (!result) {
            throw new RpcError(
                "unhandled error during bundle submission",
                ERC7769Errors.InvalidFields
            )
        }

        if (!result.success) {
            throw new RpcError(
                `bundle submission failed: ${result.reason}`,
                ERC7769Errors.InvalidFields
            )
        }

        const { transactionHash, receipt } = result

        const receiptResult = await waitForReceipt({
            rpcHandler,
            userOpHash,
            transactionHash,
            sendReceipt: receipt,
            timeoutMs: deadline - Date.now()
        })

        if (receiptResult.status === "timeout") {
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

        return receiptResult.userOpReceipt
    }
})
