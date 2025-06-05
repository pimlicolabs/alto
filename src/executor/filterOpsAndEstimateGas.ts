import {
    ArbitrumL1FeeAbi,
    RejectedUserOp,
    UserOpInfo,
    UserOperation,
    UserOperationBundle,
    UserOperationV06,
    UserOperationV07
} from "@alto/types"
import {
    Address,
    StateOverride,
    getContract,
    maxUint64,
    serializeTransaction,
    encodeFunctionData,
    Hex,
    decodeAbiParameters
} from "viem"
import { AltoConfig } from "../createConfig"
import {
    Logger,
    getHandleOpsCallData,
    scaleBigIntByPercent,
    toPackedUserOperation
} from "@alto/utils"
import { PimlicoEntryPointSimulationsAbi } from "../types/contracts/PimlicoEntryPointSimulations"
import * as sentry from "@sentry/node"
import { getEip7702DelegationOverrides } from "../utils/eip7702"
import { encodeHandleOpsCalldata, calculateAA95GasFloor } from "./utils"
import { GasPriceManager } from "../handlers/gasPriceManager"

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

const getChainSpecificOverhead = async ({
    config,
    entryPoint,
    userOps
}: { config: AltoConfig; entryPoint: Address; userOps: UserOperation[] }) => {
    const { publicClient, chainType } = config

    switch (chainType) {
        case "arbitrum": {
            const data = getHandleOpsCallData({
                userOps,
                entryPoint,
                removeZeros: false
            })

            const precompileAddress =
                "0x00000000000000000000000000000000000000C8"

            const serializedTx = serializeTransaction(
                {
                    to: entryPoint,
                    chainId: publicClient.chain?.id ?? 10,
                    nonce: 999999,
                    gasLimit: maxUint64,
                    gasPrice: maxUint64,
                    data
                },
                {
                    r: "0x123451234512345123451234512345123451234512345123451234512345",
                    s: "0x123451234512345123451234512345123451234512345123451234512345",
                    v: 28n
                }
            )

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

            let [gasEstimateForL1, ,] = result

            // scaling by 10% as reccomended by docs https://github.com/OffchainLabs/nitro-contracts/blob/bdb8f8c68b2229fe9309fe9c03b37017abd1a2cd/src/node-interface/NodeInterface.sol#L105
            return scaleBigIntByPercent(gasEstimateForL1, 110n)
        }
        default:
            return 0n
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

const getFilterOpsResult = async ({
    config,
    userOpBundle,
    gasPriceManager,
    beneficiary
}: {
    userOpBundle: UserOperationBundle
    config: AltoConfig
    gasPriceManager: GasPriceManager
    beneficiary: Address
}): Promise<{
    gasUsed: bigint
    balanceChange: bigint
    rejectedUserOps: readonly {
        userOpHash: `0x${string}`
        revertReason: `0x${string}`
    }[]
}> => {
    let {
        publicClient,
        entrypointSimulationContractV7,
        ethSimulateV1Support,
        legacyTransactions
    } = config

    if (!entrypointSimulationContractV7) {
        throw new Error("entrypointSimulationContractV7 not set")
    }

    const { userOps, version, entryPoint } = userOpBundle

    // Get EIP-7702 stateOverrides.
    let eip7702Override: StateOverride | undefined =
        getEip7702DelegationOverrides(userOps.map(({ userOp }) => userOp))

    // Create promises for parallel execution
    let data: Hex
    switch (version) {
        case "0.8": {
            data = encodeFunctionData({
                abi: PimlicoEntryPointSimulationsAbi,
                functionName: "filterOps08",
                args: [
                    userOps.map(({ userOp }) =>
                        toPackedUserOperation(userOp as UserOperationV07)
                    ),
                    beneficiary,
                    entryPoint
                ]
            })
            break
        }
        case "0.7": {
            data = encodeFunctionData({
                abi: PimlicoEntryPointSimulationsAbi,
                functionName: "filterOps07",
                args: [
                    userOps.map(({ userOp }) =>
                        toPackedUserOperation(userOp as UserOperationV07)
                    ),
                    beneficiary,
                    entryPoint
                ]
            })
            break
        }
        default: {
            data = encodeFunctionData({
                abi: PimlicoEntryPointSimulationsAbi,
                functionName: "filterOps06",
                args: [
                    userOps.map(({ userOp }) => userOp) as UserOperationV06[],
                    beneficiary,
                    entryPoint
                ]
            })
        }
    }

    let result: Hex
    if (ethSimulateV1Support && !legacyTransactions) {
        const ethSimulateV1Result = await publicClient.simulateBlocks({
            blocks: [
                {
                    calls: [
                        {
                            to: entrypointSimulationContractV7,
                            data
                        }
                    ],
                    stateOverrides: eip7702Override,
                    blockOverrides: {
                        baseFeePerGas: await gasPriceManager.getBaseFee()
                    }
                }
            ]
        })

        const simulationResult = ethSimulateV1Result[0]?.calls[0]
        if (!simulationResult || simulationResult.status === "failure") {
            throw new Error(
                "No data returned from filterOps simulation during eth_simulateV1"
            )
        }

        result = simulationResult.data
    } else {
        const callResult = await publicClient.call({
            to: entrypointSimulationContractV7,
            data,
            stateOverride: eip7702Override
        })

        if (!callResult.data) {
            throw new Error(
                "No data returned from filterOps simulation during eth_call"
            )
        }
        result = callResult.data
    }

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
    gasPriceManager
}: {
    userOpBundle: UserOperationBundle
    config: AltoConfig
    logger: Logger
    gasPriceManager: GasPriceManager
}): Promise<FilterOpsResult> {
    let { utilityWalletAddress: beneficiary } = config
    const { userOps, entryPoint } = userOpBundle

    // Create promises for parallel execution
    const filterOpsPromise = getFilterOpsResult({
        userOpBundle,
        config,
        gasPriceManager,
        beneficiary
    })

    // Start chain-specific overhead calculation in parallel
    const chainSpecificOverheadPromise = getChainSpecificOverhead({
        config,
        entryPoint,
        userOps: userOps.map(({ userOp }) => userOp)
    })

    let filterOpsResult
    let chainSpecificOverhead
    try {
        const results = await Promise.all([
            filterOpsPromise,
            chainSpecificOverheadPromise
        ])
        filterOpsResult = results[0]
        chainSpecificOverhead = results[1]
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
        bundleGasLimit: bundleGasLimit + chainSpecificOverhead,
        totalBeneficiaryFees: filterOpsResult.balanceChange
    }
}
