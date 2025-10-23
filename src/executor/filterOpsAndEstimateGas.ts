import type {
    RejectedUserOp,
    UserOpInfo,
    UserOperation,
    UserOperation06,
    UserOperation07,
    UserOperationBundle
} from "@alto/types"
import { type Logger, scaleBigIntByPercent, toPackedUserOp } from "@alto/utils"
import * as sentry from "@sentry/node"
import {
    type Address,
    type Hex,
    type StateOverride,
    decodeAbiParameters,
    decodeErrorResult,
    encodeFunctionData
} from "viem"
import { entryPoint07Abi } from "viem/account-abstraction"
import { formatAbiItemWithArgs } from "viem/utils"
import type { AltoConfig } from "../createConfig"
import { getArbitrumL1GasEstimate } from "../rpc/estimation/preVerificationGasCalculator"
import { pimlicoSimulationsAbi } from "../types/contracts/PimlicoSimulations"
import { getEip7702DelegationOverrides } from "../utils/eip7702"
import { getFilterOpsStateOverride } from "../utils/entryPointOverrides"
import { getBundleGasLimit } from "./utils"

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

    if (chainType === "arbitrum") {
        const { gasForL1 } = await getArbitrumL1GasEstimate({
            publicClient,
            userOps,
            entryPoint
        })

        return {
            gasUsed: gasForL1,
            // scaling by 10% as recommended by docs.
            // https://github.com/OffchainLabs/nitro-contracts/blob/bdb8f8c68b2229fe9309fe9c03b37017abd1a2cd/src/node-interface/NodeInterface.sol#L105
            gasLimit: scaleBigIntByPercent(gasForL1, 110n)
        }
    }

    return { gasUsed: 0n, gasLimit: 0n }
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
        ...(eip7702Override ?? []),
        ...(simulationOverrides ?? [])
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

type UserOpinfoWithEip7702Auth = UserOpInfo & {
    userOp: { eip7702Auth: NonNullable<UserOperation["eip7702Auth"]> }
}

const validateEip7702AuthNonces = async ({
    userOps,
    publicClient
}: {
    userOps: UserOpInfo[]
    publicClient: AltoConfig["publicClient"]
}): Promise<{
    rejectedUserOps: RejectedUserOp[]
    validUserOps: UserOpInfo[]
}> => {
    const eip7702UserOps = userOps.filter(
        (userOpInfo): userOpInfo is UserOpinfoWithEip7702Auth =>
            userOpInfo.userOp.eip7702Auth !== null &&
            userOpInfo.userOp.eip7702Auth !== undefined
    )
    const nonEip7702UserOps = userOps.filter(
        ({ userOp }) => !userOp.eip7702Auth
    )

    const onchainNonces = await Promise.all(
        eip7702UserOps.map(({ userOp }) =>
            publicClient.getTransactionCount({ address: userOp.sender })
        )
    )

    const rejectedUserOps: RejectedUserOp[] = []
    const validEip7702UserOps: UserOpInfo[] = []

    for (let i = 0; i < eip7702UserOps.length; i++) {
        const userOpInfo = eip7702UserOps[i]
        const expectedNonce = onchainNonces[i]
        const authNonce = userOpInfo.userOp.eip7702Auth.nonce

        if (authNonce === expectedNonce) {
            validEip7702UserOps.push(userOpInfo)
        } else {
            rejectedUserOps.push({
                ...userOpInfo,
                reason: `EIP-7702 auth nonce mismatch: expected ${expectedNonce}, got ${authNonce}`
            })
        }
    }

    return {
        rejectedUserOps,
        validUserOps: [...nonEip7702UserOps, ...validEip7702UserOps]
    }
}

// Attempt to create a handleOps bundle + estimate bundling tx gas.
export async function filterOpsAndEstimateGas({
    checkEip7702AuthNonces,
    userOpBundle,
    config,
    logger,
    networkBaseFee
}: {
    checkEip7702AuthNonces: boolean
    userOpBundle: UserOperationBundle
    config: AltoConfig
    logger: Logger
    networkBaseFee: bigint
}): Promise<FilterOpsResult> {
    const { utilityWalletAddress: beneficiary, publicClient } = config
    const { userOps, entryPoint } = userOpBundle

    try {
        let rejectedByEip7702Nonce: RejectedUserOp[] = []
        let validUserOps: UserOpInfo[] = userOps

        if (checkEip7702AuthNonces) {
            const result = await validateEip7702AuthNonces({
                userOps,
                publicClient
            })

            // Update validUserOps after eip7702 nonce check.
            validUserOps = result.validUserOps
            rejectedByEip7702Nonce = result.rejectedUserOps

            if (validUserOps.length === 0) {
                return {
                    status: "all_ops_rejected",
                    rejectedUserOps: rejectedByEip7702Nonce
                }
            }
        }

        // Create promises for parallel execution
        const filterOpsPromise = getFilterOpsResult({
            userOpBundle: { ...userOpBundle, userOps: validUserOps },
            config,
            networkBaseFee,
            beneficiary
        })

        // Start chain-specific overhead calculation in parallel
        const chainSpecificOverheadPromise = getChainSpecificOverhead({
            config,
            entryPoint,
            userOps: validUserOps.map(({ userOp }) => userOp)
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
        const userOpsToBundle = validUserOps.filter(
            ({ userOpHash }) => !rejectedUserOpHashes.includes(userOpHash)
        )
        const rejectedBySimulation = filterOpsResult.rejectedUserOps.map(
            ({ userOpHash, revertReason }) => {
                const userOpInfo = validUserOps.find(
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
                let decodedReason: string
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
                } catch {
                    // If decoding fails, keep the raw hex
                    decodedReason = revertReason
                }

                return {
                    ...userOpInfo,
                    reason: decodedReason
                }
            }
        )

        const allRejectedUserOps = [
            ...rejectedByEip7702Nonce,
            ...rejectedBySimulation
        ]

        if (userOpsToBundle.length === 0) {
            return {
                status: "all_ops_rejected",
                rejectedUserOps: allRejectedUserOps
            }
        }

        // Find gasLimit needed for this bundle
        const bundleGasLimit = await getBundleGasLimit({
            config,
            userOps: userOpsToBundle.map(({ userOp }) => userOp),
            entryPoint,
            executorAddress: beneficiary
        })

        let bundleGasUsed: bigint
        if (config.chainType === "monad") {
            // Monad uses the entire tx.gasLimit.
            bundleGasUsed = bundleGasLimit
        } else {
            // Find overhead that can't be calculated onchain.
            bundleGasUsed =
                filterOpsResult.gasUsed + 21_000n + offChainOverhead.gasUsed
        }

        return {
            status: "success",
            userOpsToBundle,
            rejectedUserOps: allRejectedUserOps,
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
