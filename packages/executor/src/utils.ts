import { IReputationManager } from "@alto/mempool"
import {
    BundleResult,
    CompressedUserOperation,
    EntryPointAbi,
    TransactionInfo,
    UserOperation,
    UserOperationWithHash,
    deriveUserOperation,
    failedOpErrorSchema
} from "@alto/types"
import { Logger, parseViemError, transactionIncluded } from "@alto/utils"
import {
    Account,
    Address,
    Chain,
    ContractFunctionRevertedError,
    EstimateGasExecutionError,
    GetContractReturnType,
    Hex,
    PublicClient,
    Transport,
    WalletClient,
    concat,
    decodeErrorResult,
    numberToHex,
    toHex,
} from "viem"
import * as sentry from "@sentry/node"

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
                success: true,
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
            success: false,
            error: {
                userOpHash: sop.owh.userOperationHash,
                reason: sop.reason as string
            }
        }
    })
}

export type DefaultFilterOpsAndEstimateGasParams = {
    ep: GetContractReturnType<typeof EntryPointAbi, PublicClient, WalletClient>,
    type: "default"
}

export type CompressedFilterOpsAndEstimateGasParams = {
    publicClient: PublicClient,
    bundleBulker: Address,
    perOpInflatorId: number,
    type: "compressed"
}

export function createCompressedCalldata(compressedOps: CompressedUserOperation[], perOpInflatorId: number): Hex {
    const callData: Hex = compressedOps.reduce((currentCallData, op) => {
        const nextCallData = concat([
            numberToHex(op.inflatorId),
            op.compressedCalldata
        ]);

        return concat([nextCallData, currentCallData])
    }, toHex(""));

  return concat([numberToHex(perOpInflatorId), callData])
}

export async function filterOpsAndEstimateGas(
    callContext: DefaultFilterOpsAndEstimateGasParams | CompressedFilterOpsAndEstimateGasParams,
    wallet: Account,
    ops: UserOperationWithHash[],
    nonce: number,
    maxFeePerGas: bigint,
    maxPriorityFeePerGas: bigint,
    blockTag: "latest" | "pending",
    onlyPre1559: boolean,
    customGasLimitForEstimation: bigint | undefined,
    reputationManager: IReputationManager,
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
            const gasOptions = onlyPre1559 ? { gasPrice: maxFeePerGas } : { maxFeePerGas, maxPriorityFeePerGas }

            if (callContext.type === "default") {
                const ep = callContext.ep
                const opsToSend = simulatedOps
                            .filter((op) => op.reason === undefined)
                            .map((op) => (op.owh.mempoolUserOperation as UserOperation))

                gasLimit = await ep.estimateGas.handleOps(
                    [
                        opsToSend,
                        wallet.address
                    ],
                    {
                        account: wallet,
                        gas: customGasLimitForEstimation,
                        nonce: nonce,
                        blockTag,
                        ...gasOptions
                    }
                )
            } else {
                const { publicClient, bundleBulker, perOpInflatorId } = callContext
                const opsToSend = simulatedOps
                            .filter((op) => op.reason === undefined)
                            .map((op) => (op.owh.mempoolUserOperation as CompressedUserOperation))

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

            return { simulatedOps, gasLimit }
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
                    return { simulatedOps: [], gasLimit: 0n }
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
                        return { simulatedOps: [], gasLimit: 0n }
                    }

                    const failingOp = simulatedOps.filter(
                        (op) => op.reason === undefined
                    )[Number(errorResult.args[0])]

                    failingOp.reason = errorResult.args[1]
                } catch (e: unknown) {
                    logger.error(
                        { error: JSON.stringify(err) },
                        "failed to parse error result"
                    )
                    return { simulatedOps: [], gasLimit: 0n }
                }
            } else {
                sentry.captureException(err)
                logger.error(
                    { error: JSON.stringify(err) },
                    "error estimating gas"
                )
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
