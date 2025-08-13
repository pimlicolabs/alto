import {
    ExecutionErrors,
    RpcError,
    type UserOperation,
    type UserOperation06,
    type UserOperation07,
    ValidationErrors,
    pimlicoSimulateAssetChangeSchema,
    pimlicoSimulationsAbi
} from "@alto/types"
import {
    isVersion06,
    isVersion07,
    isVersion08,
    toPackedUserOp
} from "@alto/utils"
import { type Address, type StateOverride, getContract } from "viem"
import { getFilterOpsStateOverride } from "../../utils/entryPointOverrides"
import { createMethodHandler } from "../createMethodHandler"
import {
    decodeSimulateHandleOpError,
    prepareSimulationOverrides07,
    simulationErrors
} from "../estimation/utils"

export const pimlicoSimulateAssetChangeHandler = createMethodHandler({
    method: "pimlico_simulateAssetChange",
    schema: pimlicoSimulateAssetChangeSchema,
    handler: async ({ rpcHandler, params }) => {
        const [
            userOp,
            entryPoint,
            balanceQueries,
            allowanceQueries,
            stateOverrides
        ] = params

        const logger = rpcHandler.logger.child({
            entryPoint,
            balanceQueries,
            allowanceQueries
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

        // Prepare state override based on version
        let stateOverride: StateOverride | undefined
        if (isVersion06(userOp) && rpcHandler.config.codeOverrideSupport) {
            stateOverride = getFilterOpsStateOverride({
                version: "0.6",
                entryPoint,
                baseFeePerGas: await rpcHandler.gasPriceManager.getBaseFee()
            })
        } else if (is07 || is08) {
            stateOverride = await prepareSimulationOverrides07({
                userOp: userOp as UserOperation07,
                queuedUserOps: [],
                entryPoint,
                gasPriceManager: rpcHandler.gasPriceManager,
                userStateOverrides: stateOverrides,
                config: rpcHandler.config
            })
        }

        try {
            let balanceChanges: {
                owner: Address
                token: Address
                balanceBefore: bigint
                balanceAfter: bigint
            }[]
            let allowanceChanges: {
                owner: Address
                token: Address
                spender: Address
                allowanceBefore: bigint
                allowanceAfter: bigint
            }[]

            if (is08) {
                if (!rpcHandler.config.entrypointSimulationContractV8) {
                    throw new RpcError(
                        "missing entrypointSimulationContractV8",
                        ValidationErrors.InvalidFields
                    )
                }

                // For EntryPoint v0.8
                const { result: simResult } =
                    await pimlicoSimulation.simulate.simulateAssetChange08(
                        [
                            toPackedUserOp(userOp as UserOperation07),
                            rpcHandler.config.entrypointSimulationContractV8,
                            entryPoint,
                            balanceQueries,
                            allowanceQueries
                        ],
                        {
                            stateOverride
                        }
                    )
                balanceChanges = [...simResult[0]]
                allowanceChanges = [...simResult[1]]
            } else if (is07) {
                if (!rpcHandler.config.entrypointSimulationContractV7) {
                    throw new RpcError(
                        "missing entrypointSimulationContractV7",
                        ValidationErrors.InvalidFields
                    )
                }

                // For EntryPoint v0.7
                const { result: simResult } =
                    await pimlicoSimulation.simulate.simulateAssetChange07(
                        [
                            toPackedUserOp(userOp as UserOperation07),
                            rpcHandler.config.entrypointSimulationContractV7,
                            entryPoint,
                            balanceQueries,
                            allowanceQueries
                        ],
                        {
                            stateOverride
                        }
                    )
                balanceChanges = [...simResult[0]]
                allowanceChanges = [...simResult[1]]
            } else {
                const { result: simResult } =
                    await pimlicoSimulation.simulate.simulateAssetChange06(
                        [
                            userOp as UserOperation06,
                            entryPoint,
                            balanceQueries,
                            allowanceQueries
                        ],
                        {
                            stateOverride
                        }
                    )
                balanceChanges = [...simResult[0]]
                allowanceChanges = [...simResult[1]]
            }

            return {
                balanceChanges,
                allowanceChanges
            }
        } catch (error) {
            const decodedError = decodeSimulateHandleOpError(error, logger)

            if (decodedError.result === "failed") {
                throw new RpcError(
                    `UserOperation reverted during simulation with reason: ${decodedError.data}`,
                    ExecutionErrors.UserOperationReverted
                )
            }

            logger.warn("Failed to decode simulation error")

            throw new RpcError(
                "Failed to decode simulation error",
                ValidationErrors.InvalidFields
            )
        }
    }
})
