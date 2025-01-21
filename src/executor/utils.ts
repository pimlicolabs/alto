import type { InterfaceReputationManager } from "@alto/mempool"
import {
    type BundleResult,
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
    failedOpWithRevertErrorSchema,
    MempoolUserOperation,
    is7702Type
} from "@alto/types"
import type { Logger } from "@alto/utils"
import {
    getRevertErrorData,
    isVersion06,
    parseViemError,
    scaleBigIntByPercent,
    toPackedUserOperation
} from "@alto/utils"
// biome-ignore lint/style/noNamespaceImport: explicitly make it clear when sentry is used
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
    decodeErrorResult,
    BaseError
} from "viem"
import { SignedAuthorizationList } from "viem/experimental"

export const isTransactionUnderpricedError = (e: BaseError) => {
    return e?.details
        ?.toLowerCase()
        .includes("replacement transaction underpriced")
}

export const getAuthorizationList = (
    mempoolUserOperations: MempoolUserOperation[]
): SignedAuthorizationList | undefined => {
    const authorizationList = mempoolUserOperations
        .map((op) => {
            if (is7702Type(op)) {
                return op.authorization
            }

            return undefined
        })
        .filter((auth) => auth !== undefined) as SignedAuthorizationList

    return authorizationList.length > 0 ? authorizationList : undefined
}

export function simulatedOpsToResults(
    simulatedOps: {
        owh: UserOperationWithHash
        reason: string | undefined
    }[],
    transactionInfo: TransactionInfo
): BundleResult[] {
    return simulatedOps.map(({ reason, owh }) => {
        if (reason === undefined) {
            return {
                status: "success",
                value: {
                    userOperation: {
                        entryPoint: transactionInfo.entryPoint,
                        mempoolUserOperation: owh.mempoolUserOperation,
                        userOperationHash: owh.userOperationHash,
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
                userOperation: owh.mempoolUserOperation,
                userOpHash: owh.userOperationHash,
                reason: reason as string
            }
        }
    })
}

export type DefaultFilterOpsAndEstimateGasParams = {}

export async function filterOpsAndEstimateGas(
    entryPoint: Address,
    ep: GetContractReturnType<
        typeof EntryPointV06Abi | typeof EntryPointV07Abi,
        {
            public: PublicClient
            wallet: WalletClient
        }
    >,
    wallet: Account,
    ops: UserOperationWithHash[],
    nonce: number,
    maxFeePerGas: bigint,
    maxPriorityFeePerGas: bigint,
    blockTag: "latest" | "pending" | undefined,
    onlyPre1559: boolean,
    fixedGasLimitForEstimation: bigint | undefined,
    reputationManager: InterfaceReputationManager,
    logger: Logger,
    authorizationList?: SignedAuthorizationList
) {
    const simulatedOps: {
        owh: UserOperationWithHash
        reason: string | undefined
    }[] = ops.map((owh) => {
        return { owh, reason: undefined }
    })

    let gasLimit: bigint

    const isUserOpV06 = isVersion06(
        simulatedOps[0].owh.mempoolUserOperation as UserOperation
    )

    const gasOptions = onlyPre1559
        ? { gasPrice: maxFeePerGas }
        : { maxFeePerGas, maxPriorityFeePerGas }

    let fixedEstimationGasLimit: bigint | undefined = fixedGasLimitForEstimation
    let retriesLeft = 5

    while (simulatedOps.filter((op) => op.reason === undefined).length > 0) {
        try {
            const opsToSend = simulatedOps
                .filter((op) => op.reason === undefined)
                .map(({ owh }) => {
                    const op = deriveUserOperation(owh.mempoolUserOperation)
                    return isUserOpV06
                        ? op
                        : toPackedUserOperation(op as UserOperationV07)
                })

            gasLimit = await ep.estimateGas.handleOps(
                // @ts-ignore - ep is set correctly for opsToSend, but typescript doesn't know that
                [opsToSend, wallet.address],
                {
                    account: wallet,
                    nonce: nonce,
                    blockTag: blockTag,
                    ...(fixedEstimationGasLimit !== undefined && {
                        gas: fixedEstimationGasLimit
                    }),
                    ...(authorizationList !== undefined && {
                        authorizationList
                    }),
                    ...gasOptions
                }
            )

            return { simulatedOps, gasLimit }
        } catch (err: unknown) {
            logger.error({ err, blockTag }, "error estimating gas")
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
                    if (
                        errorData.reason.indexOf("AA95 out of gas") !== -1 &&
                        retriesLeft > 0
                    ) {
                        retriesLeft--
                        fixedEstimationGasLimit = scaleBigIntByPercent(
                            fixedEstimationGasLimit || BigInt(30_000_000),
                            110n
                        )
                        continue
                    }

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
                        gasLimit: 0n
                    }
                }
            } else if (
                e instanceof EstimateGasExecutionError ||
                err instanceof EstimateGasExecutionError
            ) {
                if (e?.cause instanceof FeeCapTooLowError && retriesLeft > 0) {
                    retriesLeft--

                    logger.info(
                        { error: e.shortMessage },
                        "error estimating gas due to max fee < basefee"
                    )

                    if ("gasPrice" in gasOptions) {
                        gasOptions.gasPrice = scaleBigIntByPercent(
                            gasOptions.gasPrice || maxFeePerGas,
                            125n
                        )
                    }
                    if ("maxFeePerGas" in gasOptions) {
                        gasOptions.maxFeePerGas = scaleBigIntByPercent(
                            gasOptions.maxFeePerGas || maxFeePerGas,
                            125n
                        )
                    }
                    if ("maxPriorityFeePerGas" in gasOptions) {
                        gasOptions.maxPriorityFeePerGas = scaleBigIntByPercent(
                            gasOptions.maxPriorityFeePerGas ||
                                maxPriorityFeePerGas,
                            125n
                        )
                    }
                    continue
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

                    if (
                        errorResult.errorName !== "FailedOpWithRevert" &&
                        errorResult.errorName !== "FailedOp"
                    ) {
                        logger.error(
                            {
                                errorName: errorResult.errorName,
                                args: errorResult.args
                            },
                            "unexpected error result"
                        )
                        return {
                            simulatedOps: [],
                            gasLimit: 0n
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
                        gasLimit: 0n
                    }
                }
            } else {
                sentry.captureException(err)
                logger.error(
                    { error: JSON.stringify(err), blockTag },
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
        } catch (e) {
            sentry.captureException(e)
            logger.warn({ error: e }, "error flushing stuck transaction")
        }
    }
}
