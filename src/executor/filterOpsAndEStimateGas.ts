import { InterfaceReputationManager } from "@alto/mempool"
import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    FailedOpWithRevert,
    RejectedUserOp,
    UserOpInfo,
    UserOperationBundle,
    failedOpErrorSchema,
    failedOpWithRevertErrorSchema
} from "@alto/types"
import {
    Account,
    ContractFunctionRevertedError,
    EstimateGasExecutionError,
    FeeCapTooLowError,
    Hex,
    StateOverride,
    decodeErrorResult,
    getContract
} from "viem"
import { AltoConfig } from "../createConfig"
import {
    Logger,
    getRevertErrorData,
    parseViemError,
    scaleBigIntByPercent
} from "@alto/utils"
import { z } from "zod"
import { packUserOps } from "./utils"
import * as sentry from "@sentry/node"
import { getEip7702DelegationOverrides } from "../utils/eip7702"

export type FilterOpsAndEstimateGasResult =
    | {
          status: "success"
          userOpsToBundle: UserOpInfo[]
          rejectedUserOps: RejectedUserOp[]
          gasLimit: bigint
      }
    | {
          status: "unhandled_failure"
          rejectedUserOps: RejectedUserOp[]
      }
    | {
          status: "all_ops_failed_simulation"
          rejectedUserOps: RejectedUserOp[]
      }

function rejectUserOp(userOpInfo: UserOpInfo, reason: string): RejectedUserOp {
    return {
        ...userOpInfo,
        reason
    }
}

function rejectUserOps(
    userOpInfos: UserOpInfo[],
    reason: string
): RejectedUserOp[] {
    return userOpInfos.map((userOpInfo) => rejectUserOp(userOpInfo, reason))
}

// Attempt to create a handleOps bundle + estimate bundling tx gas.
export async function filterOpsAndEstimateGas({
    executor,
    userOpBundle,
    codeOverrideSupport,
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas,
    reputationManager,
    config,
    logger
}: {
    executor: Account
    userOpBundle: UserOperationBundle
    codeOverrideSupport: boolean
    nonce: number
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
    reputationManager: InterfaceReputationManager
    config: AltoConfig
    logger: Logger
}): Promise<FilterOpsAndEstimateGasResult> {
    const { userOps, version, entryPoint } = userOpBundle
    let {
        fixedGasLimitForEstimation,
        legacyTransactions,
        blockTagSupport,
        publicClient,
        walletClient
    } = config

    const isUserOpV06 = version === "0.6"
    const epContract = getContract({
        abi: isUserOpV06 ? EntryPointV06Abi : EntryPointV07Abi,
        address: entryPoint,
        client: {
            public: publicClient,
            wallet: walletClient
        }
    })

    // Keep track of invalid and valid ops
    const userOpsToBundle = [...userOps]
    const rejectedUserOps: RejectedUserOp[] = []

    // Prepare bundling tx params
    const gasOptions = legacyTransactions
        ? { gasPrice: maxFeePerGas }
        : { maxFeePerGas, maxPriorityFeePerGas }
    const blockTag = blockTagSupport ? "latest" : undefined

    let gasLimit: bigint
    let retriesLeft = 5

    while (userOpsToBundle.length > 0) {
        if (retriesLeft === 0) {
            logger.error("max retries reached")
            return {
                status: "unhandled_failure",
                rejectedUserOps: [
                    ...rejectedUserOps,
                    ...rejectUserOps(userOpsToBundle, "INTERNAL FAILURE")
                ]
            }
        }

        try {
            const packedUserOps = packUserOps(
                userOpsToBundle.map(({ userOp }) => userOp)
            )

            let stateOverride: StateOverride | undefined = undefined

            if (codeOverrideSupport) {
                stateOverride = getEip7702DelegationOverrides(
                    userOpsToBundle.map(({ userOp }) => userOp)
                )
            }

            gasLimit = await epContract.estimateGas.handleOps(
                // @ts-ignore - ep is set correctly for opsToSend, but typescript doesn't know that
                [packedUserOps, executor.address],
                {
                    account: executor,
                    nonce: nonce,
                    blockTag,
                    ...(fixedGasLimitForEstimation && {
                        gas: fixedGasLimitForEstimation
                    }),
                    ...(stateOverride && {
                        stateOverride
                    }),
                    ...gasOptions
                }
            )

            // Add gas overhead for EIP-7702 authorizations
            const eip7702AuthCount = userOpsToBundle.filter(
                ({ userOp }) => userOp.eip7702Auth
            ).length
            gasLimit += BigInt(eip7702AuthCount) * 60_000n

            return {
                status: "success",
                userOpsToBundle,
                rejectedUserOps,
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
                        status: "unhandled_failure",
                        rejectedUserOps: [
                            ...rejectedUserOps,
                            ...rejectUserOps(
                                userOpsToBundle,
                                "INTERNAL FAILURE"
                            )
                        ]
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

                    const failingOpIndex = Number(errorData.opIndex)
                    const failingUserOp = userOpsToBundle[failingOpIndex]
                    userOpsToBundle.splice(failingOpIndex, 1)

                    reputationManager.crashedHandleOps(
                        failingUserOp.userOp,
                        epContract.address,
                        errorData.reason
                    )

                    const innerError = (errorData as FailedOpWithRevert)?.inner
                    const revertReason = innerError
                        ? `${errorData.reason} - ${innerError}`
                        : errorData.reason

                    rejectedUserOps.push(
                        rejectUserOp(failingUserOp, revertReason)
                    )
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
                            status: "unhandled_failure",
                            rejectedUserOps: [
                                ...rejectedUserOps,
                                ...rejectUserOps(
                                    userOpsToBundle,
                                    "INTERNAL FAILURE"
                                )
                            ]
                        }
                    }

                    const [opIndex, reason] = errorResult.args

                    const failedOpIndex = Number(opIndex)
                    const failingUserOp = userOpsToBundle[failedOpIndex]

                    rejectedUserOps.push(rejectUserOp(failingUserOp, reason))
                    userOpsToBundle.splice(failedOpIndex, 1)

                    continue
                } catch (e: unknown) {
                    logger.error(
                        { error: JSON.stringify(err) },
                        "failed to parse error result"
                    )
                    return {
                        status: "unhandled_failure",
                        rejectedUserOps: [
                            ...rejectedUserOps,
                            ...rejectUserOps(
                                userOpsToBundle,
                                "INTERNAL FAILURE"
                            )
                        ]
                    }
                }
            } else {
                sentry.captureException(err)
                logger.error(
                    { error: JSON.stringify(err), blockTag },
                    "error estimating gas"
                )
                return {
                    status: "unhandled_failure",
                    rejectedUserOps: [
                        ...rejectedUserOps,
                        ...rejectUserOps(userOpsToBundle, "INTERNAL FAILURE")
                    ]
                }
            }
        }
    }

    return {
        status: "all_ops_failed_simulation",
        rejectedUserOps
    }
}
