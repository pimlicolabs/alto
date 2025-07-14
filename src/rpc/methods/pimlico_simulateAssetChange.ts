import {
    ExecutionErrors,
    RpcError,
    type UserOperation,
    type UserOperationV06,
    type UserOperationV07,
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
import { type Address, type Hex, type StateOverride, getContract } from "viem"
import { createMethodHandler } from "../createMethodHandler"
import {
    decodeSimulateHandleOpError,
    prepareSimulationOverrides07,
    simulationErrors
} from "../estimation/utils"
import { getFilterOpsStateOverride } from "../../utils/entryPointOverrides"

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
        let stateOverride: StateOverride | undefined
        if (isVersion06(userOp) && rpcHandler.config.codeOverrideSupport) {
            stateOverride = getFilterOpsStateOverride({
                version: "0.6",
                entryPoint,
                baseFeePerGas: await rpcHandler.gasPriceManager
                    .getBaseFee()
                    .catch(() => 0n)
            })
        } else if (is07 || is08) {
            stateOverride = await prepareSimulationOverrides07({
                userOp: userOp as UserOperationV07,
                queuedUserOps: [],
                epSimulationsAddress: epSimulationsAddress as Address,
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
                            epSimulationsAddress as Address,
                            addresses,
                            tokens
                        ],
                        {
                            stateOverride
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
                            epSimulationsAddress as Address,
                            addresses,
                            tokens
                        ],
                        {
                            stateOverride
                        }
                    )
                result = [...simResult]
            } else {
                const { result: simResult } =
                    await pimlicoSimulation.simulate.simulateAssetChange06(
                        [
                            userOp as UserOperationV06,
                            entryPoint,
                            addresses,
                            tokens
                        ],
                        {
                            stateOverride
                        }
                    )
                result = [...simResult]
            }

            return result.map(({ owner, token, diff }) => ({
                owner: owner as Hex,
                token: token as Hex,
                diff: Number(diff)
            }))
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
