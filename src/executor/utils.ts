import type { InterfaceReputationManager } from "@alto/mempool"
import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    type FailedOp,
    type FailedOpWithRevert,
    type UserOperation,
    type UserOperationV07,
    type UserOperationWithHash,
    failedOpErrorSchema,
    failedOpWithRevertErrorSchema
} from "@alto/types"
import type { Logger } from "@alto/utils"
import {
    getRevertErrorData,
    parseViemError,
    scaleBigIntByPercent,
    toPackedUserOperation
} from "@alto/utils"
// biome-ignore lint/style/noNamespaceImport: explicitly make it clear when sentry is used
import * as sentry from "@sentry/node"
import {
    type Account,
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
import { AltoConfig } from "../createConfig"
import { z } from "zod"

export const isTransactionUnderpricedError = (e: BaseError) => {
    return e?.details
        ?.toLowerCase()
        .includes("replacement transaction underpriced")
}

export const getAuthorizationList = (
    userOperations: UserOperation[]
): SignedAuthorizationList | undefined => {
    const authorizationList = userOperations
        .map((op) => {
            if (op.eip7702Auth) {
                return op.eip7702Auth
            }
            return undefined
        })
        .filter((auth) => auth !== undefined) as SignedAuthorizationList

    return authorizationList.length > 0 ? authorizationList : undefined
}

type FailedOpWithReason = {
    userOperationWithHash: UserOperationWithHash
    reason: string
}

export type FilterOpsAndEstimateGasResult =
    | {
          status: "success"
          opsToBundle: UserOperationWithHash[]
          failedOps: FailedOpWithReason[]
          gasLimit: bigint
      }
    | {
          status: "unexpectedFailure"
          reason: string
      }

// Attempt to create a handleOps bundle + estimate bundling tx gas.
export async function filterOpsAndEstimateGas({
    ep,
    isUserOpV06,
    wallet,
    ops,
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas,
    reputationManager,
    config,
    logger
}: {
    ep: GetContractReturnType<
        typeof EntryPointV06Abi | typeof EntryPointV07Abi,
        {
            public: PublicClient
            wallet: WalletClient
        }
    >
    isUserOpV06: boolean
    wallet: Account
    ops: UserOperationWithHash[]
    nonce: number
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
    reputationManager: InterfaceReputationManager
    config: AltoConfig
    logger: Logger
}): Promise<FilterOpsAndEstimateGasResult> {
    let { legacyTransactions, fixedGasLimitForEstimation, blockTagSupport } =
        config

    // Keep track of invalid and valid ops
    const opsToBundle = [...ops]
    const failedOps: FailedOpWithReason[] = []

    // Prepare bundling tx params
    const gasOptions = legacyTransactions
        ? { gasPrice: maxFeePerGas }
        : { maxFeePerGas, maxPriorityFeePerGas }
    const blockTag = blockTagSupport ? "latest" : undefined

    let gasLimit: bigint
    let retriesLeft = 5

    while (opsToBundle.length > 0 && retriesLeft > 0) {
        try {
            const encodedOps = opsToBundle.map(({ userOperation }) => {
                return isUserOpV06
                    ? userOperation
                    : toPackedUserOperation(userOperation as UserOperationV07)
            })

            const authorizationList = getAuthorizationList(
                opsToBundle.map((owh) => owh.userOperation)
            )

            gasLimit = await ep.estimateGas.handleOps(
                // @ts-ignore - ep is set correctly for opsToSend, but typescript doesn't know that
                [encodedOps, wallet.address],
                {
                    account: wallet,
                    nonce: nonce,
                    blockTag,
                    ...(fixedGasLimitForEstimation && {
                        gas: fixedGasLimitForEstimation
                    }),
                    ...(authorizationList && {
                        authorizationList
                    }),
                    ...gasOptions
                }
            )

            return {
                status: "success",
                opsToBundle,
                failedOps,
                gasLimit
            }
        } catch (err: unknown) {
            logger.error({ err, blockTag }, "handling error estimating gas")
            const e = parseViemError(err)

            if (e instanceof ContractFunctionRevertedError) {
                let parseResult = z
                    .union([failedOpErrorSchema, failedOpWithRevertErrorSchema])
                    .safeParse(e.data)

                if (!parseResult.success) {
                    sentry.captureException(err)
                    logger.error(
                        {
                            error: parseResult.error
                        },
                        "failed to parse failedOpError"
                    )
                    return {
                        status: "unexpectedFailure",
                        reason: "failed to parse failedOpError"
                    }
                }

                const errorData = parseResult.data.args

                if (errorData) {
                    if (errorData.reason.includes("AA95 out of gas")) {
                        fixedGasLimitForEstimation = scaleBigIntByPercent(
                            fixedGasLimitForEstimation || BigInt(30_000_000),
                            110n
                        )
                        retriesLeft--
                        continue
                    }

                    const failingOp = {
                        userOperationWithHash:
                            opsToBundle[Number(errorData.opIndex)],
                        reason: `${errorData.reason}${
                            (errorData as FailedOpWithRevert)?.inner
                                ? ` - ${
                                      (errorData as FailedOpWithRevert).inner
                                  }`
                                : ""
                        }`
                    }
                    opsToBundle.splice(Number(errorData.opIndex), 1)

                    reputationManager.crashedHandleOps(
                        failingOp.userOperationWithHash.userOperation,
                        ep.address,
                        failingOp.reason
                    )

                    failedOps.push(failingOp)
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
                    retriesLeft--
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
                            status: "unexpectedFailure",
                            reason: "unexpected error result"
                        }
                    }

                    const failedOpIndex = Number(errorResult.args[0])
                    const failingOp = {
                        userOperationWithHash: opsToBundle[failedOpIndex],
                        reason: errorResult.args[1]
                    }

                    failedOps.push(failingOp)
                    opsToBundle.splice(Number(errorResult.args[0]), 1)

                    continue
                } catch (e: unknown) {
                    logger.error(
                        { error: JSON.stringify(err) },
                        "failed to parse error result"
                    )
                    return {
                        status: "unexpectedFailure",
                        reason: "failed to parse error result"
                    }
                }
            } else {
                sentry.captureException(err)
                logger.error(
                    { error: JSON.stringify(err), blockTag },
                    "error estimating gas"
                )
                return {
                    status: "unexpectedFailure",
                    reason: "error estimating gas"
                }
            }
        }
    }

    return { status: "unexpectedFailure", reason: "All ops failed simulation" }
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
