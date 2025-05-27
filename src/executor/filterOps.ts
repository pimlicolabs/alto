import { RejectedUserOp, UserOpInfo, UserOperationBundle } from "@alto/types"
import { getContract } from "viem"
import { AltoConfig } from "../createConfig"
import { Logger } from "@alto/utils"
import { PimlicoEntryPointSimulationsAbi } from "../esm/types"

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
    if (!config.entrypointSimulationContractV7) {
        throw new Error("entrypointSimulationContractV7 not set")
    }

    const { userOps } = userOpBundle
    let { publicClient } = config

    const simulationContract = getContract({
        address: config.entrypointSimulationContractV7,
        abi: PimlicoEntryPointSimulationsAbi,
        client: publicClient
    })

    const beneficiary = config.utilityWalletAddress
    const simulationResult = await simulationContract.simulate.filterOps([
        userOps,
        beneficiary
    ])

    // Keep track of invalid and valid ops
    const userOpsToBundle = [...userOps]
    const rejectedUserOps: RejectedUserOp[] = []

    return {
        status: "all_ops_failed_simulation",
        rejectedUserOps
    }
}
