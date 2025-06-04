import {
    RejectedUserOp,
    UserOpInfo,
    UserOperationBundle,
    UserOperationV06,
    UserOperationV07
} from "@alto/types"
import { Address, StateOverride, getContract } from "viem"
import { AltoConfig } from "../createConfig"
import {
    Logger,
    scaleBigIntByPercent,
    toPackedUserOperation
} from "@alto/utils"
import { PimlicoEntryPointSimulationsAbi } from "../types/contracts/PimlicoEntryPointSimulations"
import * as sentry from "@sentry/node"
import { getEip7702DelegationOverrides } from "../utils/eip7702"
import { encodeHandleOpsCalldata, calculateAA95GasFloor } from "./utils"

export type FilterOpsResult =
    | {
          status: "success"
          userOpsToBundle: UserOpInfo[]
          rejectedUserOps: RejectedUserOp[]
          bundleGasUsed: bigint
          bundleGasLimit: bigint
          totalBeneficiaryFees: bigint
      }
    | {
          status: "unhandled_error"
          rejectedUserOps: RejectedUserOp[]
      }
    | {
          status: "all_ops_rejected"
          rejectedUserOps: RejectedUserOp[]
      }

const getBundleGasLimit = async ({
    config,
    userOpBundle,
    entryPoint,
    executorAddress
}: {
    config: AltoConfig
    userOpBundle: UserOpInfo[]
    entryPoint: Address
    executorAddress: Address
}): Promise<bigint> => {
    const { estimateHandleOpsGas, publicClient } = config

    let gasLimit: bigint

    // On some chains we can't rely on local calculations and have to estimate the gasLimit from RPC
    if (estimateHandleOpsGas) {
        gasLimit = await publicClient.estimateGas({
            to: entryPoint,
            account: executorAddress,
            data: encodeHandleOpsCalldata({
                userOps: userOpBundle.map(({ userOp }) => userOp),
                beneficiary: executorAddress
            })
        })
    } else {
        const aa95GasFloor = calculateAA95GasFloor({
            userOps: userOpBundle.map(({ userOp }) => userOp),
            beneficiary: executorAddress
        })

        const eip7702UserOpCount = userOpBundle.filter(
            ({ userOp }) => userOp.eip7702Auth
        ).length
        const eip7702Overhead = BigInt(eip7702UserOpCount) * 40_000n

        // Add 5% safety margin to local estimates.
        gasLimit = scaleBigIntByPercent(aa95GasFloor + eip7702Overhead, 105n)
    }

    return gasLimit
}

// Attempt to create a handleOps bundle + estimate bundling tx gas.
export async function filterOpsAndEstimateGas({
    userOpBundle,
    config,
    logger
}: {
    userOpBundle: UserOperationBundle
    config: AltoConfig
    logger: Logger
}): Promise<FilterOpsResult> {
    const { userOps, version, entryPoint } = userOpBundle
    let { publicClient, entrypointSimulationContractV7, utilityWalletAddress } =
        config

    if (!entrypointSimulationContractV7) {
        throw new Error("entrypointSimulationContractV7 not set")
    }

    const beneficiary = utilityWalletAddress
    const simulationContract = getContract({
        address: entrypointSimulationContractV7,
        abi: PimlicoEntryPointSimulationsAbi,
        client: { public: publicClient }
    })

    // Get EIP-7702 stateOverrides.
    let eip7702Override: StateOverride | undefined =
        getEip7702DelegationOverrides(userOps.map(({ userOp }) => userOp))

    let filterOpsResult
    try {
        switch (version) {
            case "0.8": {
                const simResult = await simulationContract.simulate.filterOps08(
                    [
                        userOps.map(({ userOp }) =>
                            toPackedUserOperation(userOp as UserOperationV07)
                        ),
                        beneficiary,
                        entryPoint
                    ],
                    eip7702Override ? { stateOverride: eip7702Override } : {}
                )
                filterOpsResult = simResult.result
                break
            }
            case "0.7": {
                const simResult = await simulationContract.simulate.filterOps07(
                    [
                        userOps.map(({ userOp }) =>
                            toPackedUserOperation(userOp as UserOperationV07)
                        ),
                        beneficiary,
                        entryPoint
                    ],
                    eip7702Override ? { stateOverride: eip7702Override } : {}
                )
                filterOpsResult = simResult.result
                break
            }
            default: {
                const simResult = await simulationContract.simulate.filterOps06(
                    [
                        userOps.map(
                            ({ userOp }) => userOp
                        ) as UserOperationV06[],
                        beneficiary,
                        entryPoint
                    ],
                    eip7702Override ? { stateOverride: eip7702Override } : {}
                )
                filterOpsResult = simResult.result
                break
            }
        }
    } catch (err) {
        logger.error({ err }, "Encountered unhandled error during filterOps")
        sentry.captureException(err)
        const rejectedUserOps = userOps.map((userOp) => ({
            ...userOp,
            reason: "filterOps simulation error"
        }))
        return {
            status: "unhandled_error",
            rejectedUserOps
        }
    }

    // Keep track of invalid and valid ops
    const rejectedUserOpHashes = filterOpsResult.rejectedUserOps.map(
        ({ userOpHash }) => userOpHash
    )
    const userOpsToBundle = userOps.filter(
        ({ userOpHash }) => !rejectedUserOpHashes.includes(userOpHash)
    )
    const rejectedUserOps = filterOpsResult.rejectedUserOps.map(
        ({ userOpHash, revertReason }) => {
            const userOpInfo = userOps.find(
                (op) => op.userOpHash === userOpHash
            )

            if (!userOpInfo) {
                logger.error(
                    `UserOp with hash ${userOpHash} not found in bundle`
                )
                sentry.captureException(
                    `UserOp with hash ${userOpHash} not found in bundle`
                )
                throw new Error(`UserOp with hash ${userOpHash} not found`)
            }

            return {
                ...userOpInfo,
                reason: revertReason
            }
        }
    )

    if (userOpsToBundle.length === 0) {
        return {
            status: "all_ops_rejected",
            rejectedUserOps
        }
    }

    // find overhead that can't be calculated onchain
    const bundleGasUsed = filterOpsResult.gasUsed + 21_000n

    // Find gasLimit needed for this bundle
    const bundleGasLimit = await getBundleGasLimit({
        config,
        userOpBundle: userOpsToBundle,
        entryPoint,
        executorAddress: beneficiary
    })

    return {
        status: "success",
        userOpsToBundle,
        rejectedUserOps,
        bundleGasUsed,
        bundleGasLimit,
        totalBeneficiaryFees: filterOpsResult.balanceChange
    }
}
