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
import { type Address, getContract, type Hex, toHex } from "viem"
import {
    prepareSimulationOverrides06,
    prepareSimulationOverrides07,
    simulationErrors
} from "../estimation/utils"

export const pimlicoSimulateAssetChangeHandler = createMethodHandler({
    method: "pimlico_simulateAssetChange",
    schema: pimlicoSimulateAssetChangeSchema,
    handler: async ({ rpcHandler, params }) => {
        const [userOp, entryPoint, addresses, tokens, stateOverrides] = params

        const logger = rpcHandler.logger.child({
            entryPoint,
            addresses,
            tokens
        })

        // Check if pimlico simulation contract is configured
        if (!rpcHandler.config.pimlicoSimulationContract) {
            logger.warn("pimlicoSimulation must be provided")
            throw new RpcError(
                "pimlicoSimulation must be provided",
                ValidationErrors.InvalidFields
            )
        }

        const is07 = isVersion07(userOp as UserOperation)
        const is08 = isVersion08(userOp as UserOperation, entryPoint)

        const pimlicoSimulation = getContract({
            abi: [...pimlicoSimulationsAbi, ...simulationErrors],
            address: rpcHandler.config.pimlicoSimulationContract,
            client: rpcHandler.config.publicClient
        })

        let epSimulationsAddress: Address | undefined
        if (is08) {
            epSimulationsAddress =
                rpcHandler.config.entrypointSimulationContractV8
        } else if (is07) {
            epSimulationsAddress =
                rpcHandler.config.entrypointSimulationContractV7
        }

        // Prepare state override based on version
        let stateOverride
        if (isVersion06(userOp)) {
            stateOverride = await prepareSimulationOverrides06({
                userOp: userOp as UserOperationV06,
                entryPoint,
                userStateOverrides: stateOverrides,
                useCodeOverride: true,
                config: rpcHandler.config
            })
        } else if (is07 || is08) {
            stateOverride = await prepareSimulationOverrides07({
                userOp: userOp as UserOperationV07,
                queuedUserOps: [],
                epSimulationsAddress: epSimulationsAddress!,
                gasPriceManager: rpcHandler.gasPriceManager,
                userStateOverrides: stateOverrides,
                config: rpcHandler.config
            })
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
            logger.error({ err: error }, "Error simulating asset changes")
            throw new RpcError(
                "Failed to simulate asset changes",
                ValidationErrors.SimulateValidation
            )
        }
    }
})
