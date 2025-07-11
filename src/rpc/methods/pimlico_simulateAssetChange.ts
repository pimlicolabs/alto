import { createMethodHandler } from "../createMethodHandler"
import {
    pimlicoSimulateAssetChangeSchema,
    pimlicoSimulationsAbi,
    RpcError,
    ValidationErrors,
    type UserOperation,
    type UserOperationV06,
    type UserOperationV07
} from "@alto/types"
import {
    isVersion06,
    isVersion07,
    isVersion08,
    toPackedUserOp
} from "@alto/utils"
import { type Address, getContract, type Hex, keccak256, toHex } from "viem"
import { prepareStateOverride } from "../estimation/utils"
import { simulationErrors } from "../estimation/utils"
import { toViemStateOverrides } from "../../utils/toViemStateOverrides"

export const pimlicoSimulateAssetChangeHandler = createMethodHandler({
    method: "pimlico_simulateAssetChange",
    schema: pimlicoSimulateAssetChangeSchema,
    handler: async ({ rpcHandler, params }) => {
        const [userOp, entryPoint, addresses, tokens, stateOverrides] = params

        const childLogger = rpcHandler.logger.child({
            entryPoint,
            addresses,
            tokens
        })

        // Check if pimlico simulation contract is configured
        if (!rpcHandler.config.pimlicoSimulationContract) {
            childLogger.warn("pimlicoSimulation must be provided")
            throw new RpcError(
                "pimlicoSimulation must be provided",
                ValidationErrors.InvalidFields
            )
        }

        // Determine version and get appropriate entrypoint simulations address
        const is06 = isVersion06(userOp as UserOperation)
        const is07 = isVersion07(userOp as UserOperation)
        const is08 = isVersion08(userOp as UserOperation, entryPoint)

        let epSimulationsAddress: Address | undefined
        if (is08) {
            epSimulationsAddress =
                rpcHandler.config.entrypointSimulationContractV8
        } else if (is07) {
            epSimulationsAddress =
                rpcHandler.config.entrypointSimulationContractV7
        }

        // v0.6 doesn't need entryPointSimulations address
        if (!is06 && !epSimulationsAddress) {
            const version = is08 ? "08" : "07"
            const errorMsg = `Cannot find entryPointSimulations Address for version ${version}`
            childLogger.warn(errorMsg)
            throw new Error(errorMsg)
        }

        // Get pimlico simulation contract
        const pimlicoSimulation = getContract({
            abi: [...pimlicoSimulationsAbi, ...simulationErrors],
            address: rpcHandler.config.pimlicoSimulationContract,
            client: rpcHandler.config.publicClient
        })

        // Prepare state override
        let stateOverride =
            prepareStateOverride({
                userOps: [userOp],
                queuedUserOps: [],
                config: rpcHandler.config
            }) ?? []

        // Merge user-provided state overrides if any
        if (stateOverrides) {
            const userStateOverrides = toViemStateOverrides(stateOverrides)
            stateOverride = {
                ...stateOverride,
                ...userStateOverrides
            }
        }

        // Add baseFee override for v0.7 EntryPoint simulations
        if (
            is07 &&
            epSimulationsAddress &&
            rpcHandler.config.codeOverrideSupport
        ) {
            const baseFee = await rpcHandler.gasPriceManager
                .getBaseFee()
                .catch(() => 0n)
            if (baseFee > 0n) {
                const slot = keccak256(toHex("BLOCK_BASE_FEE_PER_GAS"))
                const value = toHex(baseFee, { size: 32 })

                stateOverride = {
                    ...stateOverride,
                    [epSimulationsAddress]: {
                        ...(stateOverride as any)[epSimulationsAddress],
                        stateDiff: {
                            ...(stateOverride as any)[epSimulationsAddress]
                                ?.stateDiff,
                            [slot]: value
                        }
                    }
                }
            }
        }

        try {
            let result: { owner: Address; token: Address; diff: bigint }[]

            if (is08) {
                // For EntryPoint v0.8
                const { result: simResult } =
                    await pimlicoSimulation.simulate.simulateAssetChange08(
                        [
                            toPackedUserOp(userOp as UserOperationV07),
                            entryPoint,
                            epSimulationsAddress!,
                            addresses,
                            tokens
                        ],
                        {
                            stateOverride,
                            gas: rpcHandler.config.fixedGasLimitForEstimation
                        }
                    )
                result = [...simResult]
            } else if (is07) {
                // For EntryPoint v0.7
                const { result: simResult } =
                    await pimlicoSimulation.simulate.simulateAssetChange07(
                        [
                            toPackedUserOp(userOp as UserOperationV07),
                            entryPoint,
                            epSimulationsAddress!,
                            addresses,
                            tokens
                        ],
                        {
                            stateOverride,
                            gas: rpcHandler.config.fixedGasLimitForEstimation
                        }
                    )
                result = [...simResult]
            } else {
                // For EntryPoint v0.6 (doesn't need entryPointSimulations)
                const { result: simResult } =
                    await pimlicoSimulation.simulate.simulateAssetChange06(
                        [
                            userOp as UserOperationV06,
                            entryPoint,
                            addresses,
                            tokens
                        ],
                        {
                            stateOverride,
                            gas: rpcHandler.config.fixedGasLimitForEstimation
                        }
                    )
                result = [...simResult]
            }

            // Convert bigint diffs to hex strings for RPC response
            return result.map(({ owner, token, diff }) => ({
                owner: owner as Hex,
                token: token as Hex,
                diff: toHex(diff)
            }))
        } catch (error) {
            childLogger.error({ err: error }, "Error simulating asset changes")
            throw new RpcError(
                "Failed to simulate asset changes",
                ValidationErrors.SimulateValidation
            )
        }
    }
})
