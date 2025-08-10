import {
    ArbitrumL1FeeAbi,
    type RejectedUserOp,
    type UserOpInfo,
    type UserOperation,
    type UserOperation06,
    type UserOperation07,
    type UserOperationBundle
} from "@alto/types"
import {
    type Logger,
    getSerializedHandleOpsTx,
    scaleBigIntByPercent,
    toPackedUserOp
} from "@alto/utils"
import * as sentry from "@sentry/node"
import {
    type Address,
    type Hex,
    type StateOverride,
    decodeAbiParameters,
    decodeErrorResult,
    encodeFunctionData,
    getContract
} from "viem"
import { entryPoint07Abi } from "viem/account-abstraction"
import { formatAbiItemWithArgs } from "viem/utils"
import type { AltoConfig } from "../createConfig"
import { pimlicoSimulationsAbi } from "../types/contracts/PimlicoSimulations"
import { getEip7702DelegationOverrides } from "../utils/eip7702"
import { getFilterOpsStateOverride } from "../utils/entryPointOverrides"
import { calculateAA95GasFloor, encodeHandleOpsCalldata } from "./utils"

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

// Returns the chain specfic overhead that can't be calculated onchain.
const getChainSpecificOverhead = async ({
    config,
    entryPoint,
    userOps
}: { config: AltoConfig; entryPoint: Address; userOps: UserOperation[] }) => {
    const { publicClient, chainType } = config

    switch (chainType) {
        case "arbitrum": {
            const precompileAddress =
                "0x00000000000000000000000000000000000000C8"

            const serializedTx = getSerializedHandleOpsTx({
                userOps,
                entryPoint,
                chainId: publicClient.chain?.id ?? 10,
                removeZeros: false
            })

            const arbGasPriceOracle = getContract({
                abi: ArbitrumL1FeeAbi,
                address: precompileAddress,
                client: {
                    public: publicClient
                }
            })

            const { result } =
                await arbGasPriceOracle.simulate.gasEstimateL1Component([
                    entryPoint,
                    false,
                    serializedTx
                ])

            const [gasEstimateForL1, ,] = result

            return {
                gasUsed: gasEstimateForL1,
                // scaling by 10% as recommended by docs.
                // https://github.com/OffchainLabs/nitro-contracts/blob/bdb8f8c68b2229fe9309fe9c03b37017abd1a2cd/src/node-interface/NodeInterface.sol#L105
                gasLimit: scaleBigIntByPercent(gasEstimateForL1, 110n)
            }
        }
        default:
            return { gasUsed: 0n, gasLimit: 0n }
    }
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
    const { rpcGasEstimate, publicClient } = config

    let gasLimit: bigint

    // On some chains we can't rely on local calculations and have to estimate the gasLimit from RPC
    if (rpcGasEstimate) {
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

const getFilterOpsResult = async ({
    config,
    userOpBundle,
    networkBaseFee,
    beneficiary
}: {
    userOpBundle: UserOperationBundle
    config: AltoConfig
    networkBaseFee: bigint
    beneficiary: Address
}): Promise<{
    gasUsed: bigint
    balanceChange: bigint
    rejectedUserOps: readonly {
        userOpHash: Hex
        revertReason: Hex
    }[]
}> => {
    const {
        publicClient,
        pimlicoSimulationContract,
        codeOverrideSupport,
        fixedGasLimitForEstimation
    } = config

    if (!pimlicoSimulationContract) {
        throw new Error("pimlicoSimulationContract not set")
    }

    const { userOps, version, entryPoint } = userOpBundle

    // Get EIP-7702 stateOverrides.
    const eip7702Override: StateOverride | undefined =
        getEip7702DelegationOverrides(userOps.map(({ userOp }) => userOp))

    let simulationOverrides: StateOverride | undefined
    if (codeOverrideSupport) {
        simulationOverrides = getFilterOpsStateOverride({
            version,
            entryPoint,
            baseFeePerGas: networkBaseFee
        })
    }

    // Create promises for parallel execution
    let data: Hex
    switch (version) {
        case "0.8": {
            data = encodeFunctionData({
                abi: pimlicoSimulationsAbi,
                functionName: "filterOps08",
                args: [
                    userOps.map(({ userOp }) =>
                        toPackedUserOp(userOp as UserOperation07)
                    ),
                    beneficiary,
                    entryPoint
                ]
            })
            break
        }
        case "0.7": {
            data = encodeFunctionData({
                abi: pimlicoSimulationsAbi,
                functionName: "filterOps07",
                args: [
                    userOps.map(({ userOp }) =>
                        toPackedUserOp(userOp as UserOperation07)
                    ),
                    beneficiary,
                    entryPoint
                ]
            })
            break
        }
        default: {
            data = encodeFunctionData({
                abi: pimlicoSimulationsAbi,
                functionName: "filterOps06",
                args: [
                    userOps.map(({ userOp }) => userOp) as UserOperation06[],
                    beneficiary,
                    entryPoint
                ]
            })
        }
    }

    const stateOverride = [
        ...(eip7702Override ? eip7702Override : []),
        ...(simulationOverrides ? simulationOverrides : [])
    ]

    const callResult = await publicClient.call({
        to: pimlicoSimulationContract,
        gas: fixedGasLimitForEstimation,
        data,
        ...(stateOverride.length > 0 ? { stateOverride } : {})
    })

    if (!callResult.data) {
        throw new Error(
            "No data returned from filterOps simulation during eth_call"
        )
    }
    const result = callResult.data

    const filterOpsResult = decodeAbiParameters(
        [
            {
                name: "result",
                type: "tuple",
                components: [
                    { name: "gasUsed", type: "uint256" },
                    { name: "balanceChange", type: "uint256" },
                    {
                        name: "rejectedUserOps",
                        type: "tuple[]",
                        components: [
                            { name: "userOpHash", type: "bytes32" },
                            { name: "revertReason", type: "bytes" }
                        ]
                    }
                ]
            }
        ],
        result
    )

    return filterOpsResult[0]
}

// Attempt to create a handleOps bundle + estimate bundling tx gas.
export async function filterOpsAndEstimateGas({
    userOpBundle,
    config,
    logger,
    networkBaseFee
}: {
    userOpBundle: UserOperationBundle
    config: AltoConfig
    logger: Logger
    networkBaseFee: bigint
}): Promise<FilterOpsResult> {
    const { utilityWalletAddress: beneficiary } = config
    const { userOps, entryPoint } = userOpBundle

    try {
        // Create promises for parallel execution
        const filterOpsPromise = getFilterOpsResult({
            userOpBundle,
            config,
            networkBaseFee,
            beneficiary
        })

        // Start chain-specific overhead calculation in parallel
        const chainSpecificOverheadPromise = getChainSpecificOverhead({
            config,
            entryPoint,
            userOps: userOps.map(({ userOp }) => userOp)
        })

        const results = await Promise.all([
            filterOpsPromise,
            chainSpecificOverheadPromise
        ])
        const filterOpsResult = results[0]
        const offChainOverhead = results[1]

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

                // Try to decode the revert reason
                let decodedReason: string = revertReason
                try {
                    const errorResult = decodeErrorResult({
                        abi: entryPoint07Abi,
                        data: revertReason
                    })

                    const formattedError = formatAbiItemWithArgs({
                        abiItem: errorResult.abiItem,
                        args: errorResult.args,
                        includeFunctionName: true,
                        includeName: false
                    })

                    decodedReason = formattedError || revertReason
                } catch (e) {
                    // If decoding fails, keep the raw hex
                    decodedReason = revertReason
                }

                return {
                    ...userOpInfo,
                    reason: decodedReason
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
        const bundleGasUsed =
            filterOpsResult.gasUsed + 21_000n + offChainOverhead.gasUsed

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
            bundleGasLimit: bundleGasLimit + offChainOverhead.gasLimit,
            totalBeneficiaryFees: filterOpsResult.balanceChange
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
}
