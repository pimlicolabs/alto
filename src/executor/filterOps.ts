import {
    RejectedUserOp,
    UserOpInfo,
    UserOperationBundle,
    UserOperationV06,
    UserOperationV07
} from "@alto/types"
import { getContract } from "viem"
import { AltoConfig } from "../createConfig"
import { Logger, toPackedUserOperation } from "@alto/utils"
import { PimlicoEntryPointSimulationsAbi } from "../types/contracts/PimlicoEntryPointSimulations"
import * as sentry from "@sentry/node"

export type FilterOpsAndEstimateGasResult =
    | {
          status: "success"
          userOpsToBundle: UserOpInfo[]
          rejectedUserOps: RejectedUserOp[]
          gasUsed: bigint
          balanceChange: bigint
      }
    | {
          status: "unhandled_failure"
      }

// Attempt to create a handleOps bundle + estimate bundling tx gas.
export async function filterOps({
    userOpBundle,
    config,
    logger
}: {
    userOpBundle: UserOperationBundle
    config: AltoConfig
    logger: Logger
}): Promise<FilterOpsAndEstimateGasResult> {
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
                    ]
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
                    ]
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
                    ]
                )
                filterOpsResult = simResult.result
                break
            }
        }
    } catch (err) {
        logger.error("Encount")
        sentry.captureException(err)
        return {
            status: "unhandled_failure"
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

    return {
        status: "success",
        userOpsToBundle,
        rejectedUserOps,
        gasUsed: filterOpsResult.gasUsed,
        balanceChange: filterOpsResult.balanceChange
    }
}
