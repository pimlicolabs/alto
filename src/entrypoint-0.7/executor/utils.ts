import type { InterfaceReputationManager } from "@entrypoint-0.7/mempool"
import {
    type BundleResult,
    type CompressedUserOperation,
    EntryPointAbi,
    type TransactionInfo,
    type UserOperationWithHash,
    deriveUserOperation,
    failedOpErrorSchema,
    type UnPackedUserOperation
} from "@entrypoint-0.7/types"
import type { Logger } from "@alto/utils"
import {
    parseViemError,
    toPackedUserOperation,
    transactionIncluded
} from "@entrypoint-0.7/utils"
import * as sentry from "@sentry/node"
import {
    type Account,
    type Address,
    type Chain,
    ContractFunctionRevertedError,
    EstimateGasExecutionError,
    FeeCapTooLowError,
    type GetContractReturnType,
    type Hex,
    type PublicClient,
    type Transport,
    type WalletClient,
    concat,
    decodeErrorResult,
    hexToBytes,
    numberToHex
} from "viem"

export function simulatedOpsToResults(
    simulatedOps: {
        owh: UserOperationWithHash
        reason: string | undefined
    }[],
    transactionInfo: TransactionInfo
): BundleResult[] {
    return simulatedOps.map((sop) => {
        if (sop.reason === undefined) {
            return {
                status: "success",
                value: {
                    userOperation: {
                        mempoolUserOperation: sop.owh.mempoolUserOperation,
                        userOperationHash: sop.owh.userOperationHash,
                        lastReplaced: Date.now(),
                        firstSubmitted: Date.now()
                    },
                    transactionInfo
                }
            }
        }
        return {
            status: "failure",
            error: {
                userOpHash: sop.owh.userOperationHash,
                reason: sop.reason as string
            }
        }
    })
}

export type DefaultFilterOpsAndEstimateGasParams = {
    ep: GetContractReturnType<typeof EntryPointAbi, PublicClient, WalletClient>
    type: "default"
}

export type CompressedFilterOpsAndEstimateGasParams = {
    publicClient: PublicClient
    bundleBulker: Address
    perOpInflatorId: number
    type: "compressed"
}

export function createCompressedCalldata(
    compressedOps: CompressedUserOperation[],
    perOpInflatorId: number
): Hex {
    const bundleBulkerPayload = numberToHex(perOpInflatorId, { size: 4 }) // bytes used in BundleBulker
    const perOpInflatorPayload = numberToHex(compressedOps.length, { size: 1 }) // bytes used in perOpInflator

    return compressedOps.reduce(
        (currentCallData, op) => {
            const nextCallData = concat([
                numberToHex(op.inflatorId, { size: 4 }),
                numberToHex(hexToBytes(op.compressedCalldata).length, {
                    size: 2
                }),
                op.compressedCalldata
            ])

            return concat([currentCallData, nextCallData])
        },
        concat([bundleBulkerPayload, perOpInflatorPayload])
    )
}

export async function filterOpsAndEstimateGas(
    callContext:
        | DefaultFilterOpsAndEstimateGasParams
        | CompressedFilterOpsAndEstimateGasParams,
    wallet: Account,
    ops: UserOperationWithHash[],
    nonce: number,
    maxFeePerGas: bigint,
    maxPriorityFeePerGas: bigint,
    blockTag: "latest" | "pending",
    onlyPre1559: boolean,
    customGasLimitForEstimation: bigint | undefined,
    reputationManager: InterfaceReputationManager,
    logger: Logger
) {
    const simulatedOps: {
        owh: UserOperationWithHash
        reason: string | undefined
    }[] = ops.map((owh) => {
        return { owh, reason: undefined }
    })

    let gasLimit: bigint

    while (simulatedOps.filter((op) => op.reason === undefined).length > 0) {
        try {
            const gasOptions = onlyPre1559
                ? { gasPrice: maxFeePerGas }
                : { maxFeePerGas, maxPriorityFeePerGas }

            if (callContext.type === "default") {
                const ep = callContext.ep
                const opsToSend = simulatedOps
                    .filter((op) => op.reason === undefined)
                    .map((op) =>
                        toPackedUserOperation(
                            op.owh.mempoolUserOperation as UnPackedUserOperation
                        )
                    )

                gasLimit = await ep.estimateGas.handleOps(
                    [opsToSend, wallet.address],
                    {
                        account: wallet,
                        gas: customGasLimitForEstimation,
                        nonce: nonce,
                        blockTag,
                        ...gasOptions
                    }
                )
            } else {
                const { publicClient, bundleBulker, perOpInflatorId } =
                    callContext
                const opsToSend = simulatedOps
                    .filter((op) => op.reason === undefined)
                    .map(
                        (op) =>
                            op.owh
                                .mempoolUserOperation as CompressedUserOperation
                    )

                gasLimit = await publicClient.estimateGas({
                    to: bundleBulker,
                    account: wallet,
                    data: createCompressedCalldata(opsToSend, perOpInflatorId),
                    gas: customGasLimitForEstimation,
                    nonce: nonce,
                    blockTag,
                    ...gasOptions
                })
            }

            return { simulatedOps, gasLimit, resubmitAllOps: false }
        } catch (err: unknown) {
            const e = parseViemError(err)
            if (e instanceof ContractFunctionRevertedError) {
                const parsingResult = failedOpErrorSchema.safeParse(e.data)
                if (parsingResult.success) {
                    const failedOpError = parsingResult.data
                    logger.debug(
                        {
                            failedOpError,
                            userOpHashes: simulatedOps
                                .filter((op) => op.reason === undefined)
                                .map((op) => op.owh.userOperationHash)
                        },
                        "user op in batch invalid"
                    )

                    const failingOp = simulatedOps.filter(
                        (op) => op.reason === undefined
                    )[Number(failedOpError.args.opIndex)]

                    failingOp.reason = failedOpError.args.reason
                    reputationManager.crashedHandleOps(
                        deriveUserOperation(failingOp.owh.mempoolUserOperation),
                        failingOp.reason
                    )
                } else {
                    sentry.captureException(err)
                    logger.error(
                        {
                            error: parsingResult.error
                        },
                        "failed to parse failedOpError"
                    )
                    return {
                        simulatedOps: [],
                        gasLimit: 0n,
                        resubmitAllOps: false
                    }
                }
            } else if (e instanceof EstimateGasExecutionError) {
                try {
                    const errorHexData = e.details.split("Reverted ")[1] as Hex
                    const errorResult = decodeErrorResult({
                        abi: EntryPointAbi,
                        data: errorHexData
                    })
                    logger.debug(
                        {
                            errorName: errorResult.errorName,
                            args: errorResult.args,
                            userOpHashes: simulatedOps
                                .filter((op) => op.reason === undefined)
                                .map((op) => op.owh.userOperationHash)
                        },
                        "user op in batch invalid"
                    )

                    if (errorResult.errorName !== "FailedOp") {
                        logger.error(
                            {
                                errorName: errorResult.errorName,
                                args: errorResult.args
                            },
                            "unexpected error result"
                        )
                        return {
                            simulatedOps: [],
                            gasLimit: 0n,
                            resubmitAllOps: false
                        }
                    }

                    const failingOp = simulatedOps.filter(
                        (op) => op.reason === undefined
                    )[Number(errorResult.args[0])]

                    failingOp.reason = errorResult.args[1]
                } catch (_e: unknown) {
                    logger.error(
                        { error: JSON.stringify(err) },
                        "failed to parse error result"
                    )
                    return {
                        simulatedOps: [],
                        gasLimit: 0n,
                        resubmitAllOps: false
                    }
                }
            } else if (e instanceof EstimateGasExecutionError) {
                if (e.cause instanceof FeeCapTooLowError) {
                    logger.info(
                        { error: e.shortMessage },
                        "error estimating gas due to max fee < basefee"
                    )
                    return {
                        simulatedOps: simulatedOps,
                        gasLimit: 0n,
                        resubmitAllOps: true
                    }
                }
            } else {
                sentry.captureException(err)
                logger.error(
                    { error: JSON.stringify(err) },
                    "error estimating gas"
                )
                return { simulatedOps: [], gasLimit: 0n, resubmitAllOps: false }
            }
        }
    }
    return { simulatedOps, gasLimit: 0n, resubmitAllOps: false }
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

    logger.debug(
        { latestNonce, pendingNonce, wallet: wallet.address },
        "checking for stuck transactions"
    )

    // same nonce is okay
    if (latestNonce === pendingNonce) {
        return
    }

    // one nonce ahead is also okay
    if (latestNonce + 1 === pendingNonce) {
        return
    }

    logger.info(
        { latestNonce, pendingNonce, wallet: wallet.address },
        "found stuck transaction, flushing"
    )

    for (
        let nonceToFlush = latestNonce;
        nonceToFlush < pendingNonce;
        nonceToFlush++
    ) {
        try {
            const txHash = await walletClient.sendTransaction({
                account: wallet,
                to: wallet.address,
                value: 0n,
                nonce: nonceToFlush,
                maxFeePerGas: gasPrice,
                maxPriorityFeePerGas: gasPrice
            })

            logger.debug(
                { txHash, nonce: nonceToFlush, wallet: wallet.address },
                "flushed stuck transaction"
            )

            await transactionIncluded(txHash, publicClient)
        } catch (e) {
            sentry.captureException(e)
            logger.warn({ error: e }, "error flushing stuck transaction")
        }
    }
}
