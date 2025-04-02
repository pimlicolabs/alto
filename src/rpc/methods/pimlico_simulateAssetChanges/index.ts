import { createMethodHandler } from "../../createMethodHandler"
import { RpcError, pimlicoSimulateAssetChangesSchema } from "@alto/types"
import { createMemoryClient, http } from "tevm"
import { optimism as tevmOptimism } from "tevm/common"
import { getAddress, toEventSelector, toHex } from "viem"
import { isVersion06 } from "../../../utils/userop"
import type { AltoConfig } from "../../../createConfig"
import {
    getSimulateHandleOpCallData,
    validateSimulateHandleOpResult
} from "./userOpSimulationHelper"

// Both ERC-20 and ERC-721 use the same event signature
const TRANSFER_TOPIC_HASH = toEventSelector(
    "event Transfer(address indexed from, address indexed to, uint256 value)"
)

async function setupTevm(config: AltoConfig, blockNumber?: bigint) {
    const options = {
        fork: {
            transport: http(config.rpcUrl),
            ...(blockNumber !== undefined
                ? { blockNumber }
                : { blockTag: "latest" as const })
        },
        ...(config.chainType === "op-stack" ? { common: tevmOptimism } : {})
    }
    return createMemoryClient(options)
}

// NOTE: Endpoint to simulate asset changes that a user operation produces.
// According to the ERC-20 and ERC-721 spec, a event must be emitted for each transfer and approval of a token.
// We can collect any transfers by listening for these events when running the simulation.
export const pimlicoSimulateAssetChangesHandler = createMethodHandler({
    method: "pimlico_simulateAssetChanges",
    schema: pimlicoSimulateAssetChangesSchema,
    handler: async ({ rpcHandler, params }) => {
        const { config } = rpcHandler
        const [userOperation, entryPoint, blockNumber] = params

        // Validations
        if (isVersion06(userOperation)) {
            throw new RpcError(
                "pimlico_simulateAssetChanges is not supported for v0.6"
            )
        }

        if (!config.entrypointSimulationContract) {
            throw new RpcError("Missing entryPoint simulations contract")
        }

        const tevmClient = await setupTevm(config, blockNumber)

        const callData = getSimulateHandleOpCallData({
            // @ts-ignore
            userOperation,
            entryPoint
        })

        // Track which addresses have been touched by simulation
        const logs = []

        const callResult = await tevmClient.tevmCall({
            to: config.entrypointSimulationContract,
            data: callData,

            onStep: (step) => {
                const { opcode } = step

                // We have to manually record logs as the simulation reverts which also reverts all logs.
                if (opcode.name === "LOG3") {
                    try {
                        const { stack, memory } = step
                        const stackLength = stack.length

                        // Get event topics.
                        const opts = { size: 32 }
                        const topic0 = toHex(stack[stackLength - 3], opts)
                        const topic1 = toHex(stack[stackLength - 4], opts)
                        const topic2 = toHex(stack[stackLength - 5], opts)

                        // Check if this is a transfer event
                        if (topic0 !== TRANSFER_TOPIC_HASH) {
                            return
                        }

                        // Check if transfer touches userOp.sender
                        if (
                            getAddress(topic1) !== userOperation.sender &&
                            getAddress(topic2) !== userOperation.sender
                        ) {
                            return
                        }

                        // Get event data.
                        const offset = stack[stackLength - 1]
                        const size = stack[stackLength - 2]
                        const data = toHex(
                            memory.slice(
                                Number(offset),
                                Number(offset) + Number(size)
                            )
                        )

                        logs.push({
                            address: getAddress(toHex(step.address.bytes)),
                            topics: [topic0, topic1, topic2],
                            data
                        })
                    } catch (err) {
                        rpcHandler.logger.error(
                            { err },
                            "Error processing LOG3 event"
                        )
                    }
                }

                if (opcode.name === "LOG4") {
                    try {
                        const { stack, memory } = step
                        const stackLength = stack.length

                        // Get event topics.
                        const opts = { size: 32 }
                        const topic0 = toHex(stack[stackLength - 3], opts)
                        const topic1 = toHex(stack[stackLength - 4], opts)
                        const topic2 = toHex(stack[stackLength - 5], opts)
                        const topic3 = toHex(stack[stackLength - 6], opts)

                        // Get event data.
                        const offset = stack[stackLength - 1]
                        const size = stack[stackLength - 2]
                        const data = toHex(
                            memory.slice(
                                Number(offset),
                                Number(offset) + Number(size)
                            )
                        )

                        logs.push({
                            address: getAddress(toHex(step.address.bytes)),
                            data,
                            topics: [topic0, topic1, topic2, topic3]
                        })
                    } catch (err) {
                        rpcHandler.logger.error(
                            { err },
                            "Error processing LOG4 event"
                        )
                    }
                }
            }
        })

        validateSimulateHandleOpResult({
            data: callResult.rawData,
            logger: rpcHandler.logger
        })
    }
})
