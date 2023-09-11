import { BundleResult, EntryPointAbi, TransactionInfo, UserOperationWithHash, failedOpErrorSchema } from "@alto/types"
import { Logger, transactionIncluded } from "@alto/utils"
import {
    ContractFunctionExecutionError,
    NonceTooLowError,
    FeeCapTooLowError,
    InsufficientFundsError,
    IntrinsicGasTooLowError,
    ContractFunctionRevertedError,
    GetContractReturnType,
    PublicClient,
    WalletClient,
    Account,
    Transport,
    Chain
} from "viem"

export function simulatedOpsToResults(
    simulatedOps: {
        op: UserOperationWithHash
        reason: string | undefined
    }[],
    transactionInfo: TransactionInfo
): BundleResult[] {
    return simulatedOps.map((sop) => {
        if (sop.reason === undefined) {
            return {
                success: true,
                value: {
                    userOperation: {
                        userOperation: sop.op.userOperation,
                        userOperationHash: sop.op.userOperationHash,
                        lastReplaced: Date.now(),
                        firstSubmitted: Date.now()
                    },
                    transactionInfo
                }
            }
        } else {
            return {
                success: false,
                error: {
                    userOpHash: sop.op.userOperationHash,
                    reason: sop.reason as string
                }
            }
        }
    })
}

export function parseViemError(err: unknown) {
    if (err instanceof ContractFunctionExecutionError) {
        const e = err.walk()
        if (e instanceof NonceTooLowError) {
            return e
        } else if (e instanceof FeeCapTooLowError) {
            return e
        } else if (e instanceof InsufficientFundsError) {
            return e
        } else if (e instanceof IntrinsicGasTooLowError) {
            return e
        } else if (e instanceof ContractFunctionRevertedError) {
            return e
        }
        return
    } else {
        return
    }
}

export async function filterOpsAndEstimateGas(
    ep: GetContractReturnType<typeof EntryPointAbi, PublicClient, WalletClient>,
    wallet: Account,
    ops: UserOperationWithHash[],
    nonce: number,
    maxFeePerGas: bigint,
    maxPriorityFeePerGas: bigint,
    blockTag: "latest" | "pending",
    logger: Logger
) {
    const simulatedOps: {
        op: UserOperationWithHash
        reason: string | undefined
    }[] = ops.map((op) => {
        return { op, reason: undefined }
    })

    let gasLimit: bigint

    while (simulatedOps.filter((op) => op.reason === undefined).length > 0) {
        try {
            gasLimit = await ep.estimateGas.handleOps(
                [simulatedOps.filter((op) => op.reason === undefined).map((op) => op.op.userOperation), wallet.address],
                {
                    account: wallet,
                    maxFeePerGas: maxFeePerGas,
                    maxPriorityFeePerGas: maxPriorityFeePerGas,
                    nonce: nonce,
                    blockTag
                }
            )

            return { simulatedOps, gasLimit }
        } catch (err: unknown) {
            const e = parseViemError(err)
            if (e instanceof ContractFunctionRevertedError) {
                const parsingResult = failedOpErrorSchema.safeParse(e.data)
                if (parsingResult.success) {
                    const failedOpError = parsingResult.data
                    logger.warn({ failedOpError }, "user op in batch invalid")

                    const failingOp = simulatedOps.filter((op) => op.reason === undefined)[
                        Number(failedOpError.args.opIndex)
                    ]

                    failingOp.reason = failedOpError.args.reason
                } else {
                    logger.error({ error: parsingResult.error }, "failed to parse failedOpError")
                    return { simulatedOps: [], gasLimit: 0n }
                }
            } else {
                logger.error({ error: err }, "error estimating gas")
                return { simulatedOps: [], gasLimit: 0n }
            }
        }
    }
    return { simulatedOps, gasLimit: 0n }
}

export async function flushStuckTransaction(
    publicClient: PublicClient,
    walletClient: WalletClient<Transport, Chain, Account | undefined>,
    wallet: Account,
    gasPrice: bigint,
    logger: Logger
) {
    const latestNonce = await publicClient.getTransactionCount({
        address: wallet.address,
        blockTag: "latest"
    })
    const pendingNonce = await publicClient.getTransactionCount({
        address: wallet.address,
        blockTag: "pending"
    })

    logger.debug({ latestNonce, pendingNonce, wallet: wallet.address }, "checking for stuck transactions")

    // same nonce is okay
    if (latestNonce === pendingNonce) {
        return
    }

    // one nonce ahead is also okay
    if (latestNonce + 1 === pendingNonce) {
        return
    }

    logger.info({ latestNonce, pendingNonce, wallet: wallet.address }, "found stuck transaction, flushing")

    for (let nonceToFlush = latestNonce; nonceToFlush < pendingNonce; nonceToFlush++) {
        try {
            const txHash = await walletClient.sendTransaction({
                account: wallet,
                to: wallet.address,
                value: 0n,
                nonce: nonceToFlush,
                maxFeePerGas: gasPrice,
                maxPriorityFeePerGas: gasPrice
            })

            logger.debug({ txHash, nonce: nonceToFlush, wallet: wallet.address }, "flushed stuck transaction")

            await transactionIncluded(txHash, publicClient)
        } catch (e) {
            logger.warn({ error: e }, "error flushing stuck transaction")
        }
    }
}
