import { InterfaceReputationManager } from "@alto/mempool"
import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    FailedOpWithRevert,
    UserOperationInfo,
    UserOperationV07,
    failedOpErrorSchema,
    failedOpWithRevertErrorSchema
} from "@alto/types"
import {
    Account,
    ContractFunctionRevertedError,
    EstimateGasExecutionError,
    FeeCapTooLowError,
    GetContractReturnType,
    Hex,
    PublicClient,
    WalletClient,
    decodeErrorResult
} from "viem"
import { AltoConfig } from "../createConfig"
import {
    Logger,
    getRevertErrorData,
    parseViemError,
    scaleBigIntByPercent,
    toPackedUserOperation
} from "@alto/utils"
import { z } from "zod"
import { getAuthorizationList } from "./utils"
import * as sentry from "@sentry/node"

type FailedOpWithReason = {
    userOperation: UserOperationInfo
    reason: string
}

export type FilterOpsAndEstimateGasResult =
    | {
          status: "success"
          opsToBundle: UserOperationInfo[]
          failedOps: FailedOpWithReason[]
          gasLimit: bigint
      }
    | {
          status: "unexpected_failure"
          reason: string
      }
    | {
          status: "all_ops_failed_simulation"
          failedOps: FailedOpWithReason[]
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
    ops: UserOperationInfo[]
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
            const encodedOps = opsToBundle.map((userOperation) => {
                return isUserOpV06
                    ? userOperation
                    : toPackedUserOperation(userOperation as UserOperationV07)
            })

            const authorizationList = getAuthorizationList(opsToBundle)

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
                        status: "unexpected_failure",
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

                    const innerError = (errorData as FailedOpWithRevert)?.inner
                    const reason = innerError
                        ? `${errorData.reason} - ${innerError}`
                        : errorData.reason

                    const failingOp = {
                        userOperation: opsToBundle[Number(errorData.opIndex)],
                        reason
                    }
                    opsToBundle.splice(Number(errorData.opIndex), 1)

                    reputationManager.crashedHandleOps(
                        failingOp.userOperation,
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
                            status: "unexpected_failure",
                            reason: "unexpected error result"
                        }
                    }

                    const failedOpIndex = Number(errorResult.args[0])
                    const failingOp = {
                        userOperation: opsToBundle[failedOpIndex],
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
                        status: "unexpected_failure",
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
                    status: "unexpected_failure",
                    reason: "error estimating gas"
                }
            }
        }
    }

    return { status: "all_ops_failed_simulation", failedOps }
}
