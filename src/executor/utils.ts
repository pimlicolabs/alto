import type { InterfaceReputationManager } from "@alto/mempool"
import {
    type BundleResult,
    type CompressedUserOperation,
    EntryPointV06Abi,
    EntryPointV07Abi,
    type FailedOp,
    type FailedOpWithRevert,
    type TransactionInfo,
    type UserOperation,
    type UserOperationV07,
    type UserOperationWithHash,
    deriveUserOperation,
    failedOpErrorSchema,
    failedOpWithRevertErrorSchema
} from "@alto/types"
import type { Logger } from "@alto/utils"
import {
    getRevertErrorData,
    isVersion06,
    parseViemError,
    toPackedUserOperation,
    transactionIncluded
} from "@alto/utils"
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
                        entryPoint: transactionInfo.entryPoint,
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
                entryPoint: transactionInfo.entryPoint,
                userOpHash: sop.owh.userOperationHash,
                reason: sop.reason as string
            }
        }
    })
}

export type DefaultFilterOpsAndEstimateGasParams = {
    ep: GetContractReturnType<
        typeof EntryPointV06Abi | typeof EntryPointV07Abi,
        {
            public: PublicClient
            wallet: WalletClient
        }
    >
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
    entryPoint: Address,
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
    fixedGasLimitForEstimation: bigint | undefined,
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

    // TODO compressed ops are not supported in V07
    const isUserOpV06 =
        callContext.type === "default"
            ? isVersion06(
                  simulatedOps[0].owh.mempoolUserOperation as UserOperation
              )
            : true

    while (simulatedOps.filter((op) => op.reason === undefined).length > 0) {
        try {
            const gasOptions = onlyPre1559
                ? { gasPrice: maxFeePerGas }
                : { maxFeePerGas, maxPriorityFeePerGas }

            if (callContext.type === "default") {
                const ep = callContext.ep

                const opsToSend = simulatedOps
                    .filter((op) => op.reason === undefined)
                    .map((op) => {
                        return isUserOpV06
                            ? op.owh.mempoolUserOperation
                            : toPackedUserOperation(
                                  op.owh
                                      .mempoolUserOperation as UserOperationV07
                              )
                    })

                gasLimit = await ep.estimateGas.handleOps(
                    // @ts-ignore - ep is set correctly for opsToSend, but typescript doesn't know that
                    [opsToSend, wallet.address],
                    {
                        account: wallet,
                        nonce: nonce,
                        blockTag,
                        ...(fixedGasLimitForEstimation !== undefined && {
                            gas: fixedGasLimitForEstimation
                        }),
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
                    gas: fixedGasLimitForEstimation,
                    nonce: nonce,
                    blockTag,
                    ...gasOptions
                })
            }

            return { simulatedOps, gasLimit, resubmitAllOps: false }
        } catch (err: unknown) {
            logger.error({ err }, "error estimating gas")
            const e = parseViemError(err)

            if (e instanceof ContractFunctionRevertedError) {
                const failedOpError = failedOpErrorSchema.safeParse(e.data)
                const failedOpWithRevertError =
                    failedOpWithRevertErrorSchema.safeParse(e.data)

                let errorData: FailedOp | FailedOpWithRevert | undefined =
                    undefined

                if (failedOpError.success) {
                    errorData = failedOpError.data.args
                }
                if (failedOpWithRevertError.success) {
                    errorData = failedOpWithRevertError.data.args
                }

                if (errorData) {
                    logger.debug(
                        {
                            errorData,
                            userOpHashes: simulatedOps
                                .filter((op) => op.reason === undefined)
                                .map((op) => op.owh.userOperationHash)
                        },
                        "user op in batch invalid"
                    )

                    const failingOp = simulatedOps.filter(
                        (op) => op.reason === undefined
                    )[Number(errorData.opIndex)]

                    failingOp.reason = `${errorData.reason}${
                        (errorData as FailedOpWithRevert)?.inner
                            ? ` - ${(errorData as FailedOpWithRevert).inner}`
                            : ""
                    }`

                    reputationManager.crashedHandleOps(
                        deriveUserOperation(failingOp.owh.mempoolUserOperation),
                        entryPoint,
                        failingOp.reason
                    )
                }

                if (
                    !(failedOpError.success || failedOpWithRevertError.success)
                ) {
                    sentry.captureException(err)
                    logger.error(
                        {
                            error: `${failedOpError.error} ${failedOpWithRevertError.error}`
                        },
                        "failed to parse failedOpError"
                    )
                    return {
                        simulatedOps: [],
                        gasLimit: 0n,
                        resubmitAllOps: false
                    }
                }
            } else if (
                e instanceof EstimateGasExecutionError ||
                err instanceof EstimateGasExecutionError
            ) {
                if (e?.cause instanceof FeeCapTooLowError) {
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

                try {
                    let errorHexData: Hex = "0x"

                    if (err instanceof EstimateGasExecutionError) {
                        errorHexData = getRevertErrorData(err) as Hex
                    } else {
                        errorHexData = e?.details.split("Reverted ")[1] as Hex
                    }
                    const errorResult = decodeErrorResult({
                        abi: isUserOpV06 ? EntryPointV06Abi : EntryPointV07Abi,
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
                } catch (e: unknown) {
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
    logger: Logger,
    entryPoint: Address
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

            // TODO: We don't know if the entrypoint is the V06 or V07. So we try and catch both.
            await transactionIncluded(true, txHash, publicClient, entryPoint)
            await transactionIncluded(false, txHash, publicClient, entryPoint)
        } catch (e) {
            sentry.captureException(e)
            logger.warn({ error: e }, "error flushing stuck transaction")
        }
    }
}
