import { createMethodHandler } from "../../createMethodHandler"
import {
    AssetChange,
    RpcError,
    ValidationErrors,
    pimlicoSimulateAssetChangesSchema
} from "@alto/types"
import { createMemoryClient, http } from "tevm"
import { optimism as tevmOptimism } from "tevm/common"
import { getAddress, toHex, Address, slice } from "viem"
import { isVersion06 } from "../../../utils/userop"
import type { AltoConfig } from "../../../createConfig"
import {
    getSimulateHandleOpCallData,
    validateSimulateHandleOpResult
} from "./userOpSimulationHelper"
import { getTokenInfo } from "./getTokenMetadata"
import { getAssetChangesFromLogs } from "./parseLogsByTokenType"
import {
    LogType,
    TRANSFER_BATCH_TOPIC_HASH,
    TRANSFER_SINGLE_TOPIC_HASH,
    TRANSFER_TOPIC_HASH
} from "./types"

async function setupTevm(config: AltoConfig, blockNumber?: bigint) {
    const options = {
        fork: {
            transport: http(config.rpcUrl),
            ...(blockNumber !== undefined
                ? {
                      blockNumber
                  }
                : {
                      blockTag: "latest" as const
                  })
        },
        ...(config.chainType === "op-stack"
            ? {
                  common: tevmOptimism
              }
            : {})
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

        if (!config.enableSimulateBalanceChangesEndpoint) {
            if (!rpcHandler.config.enableInstantBundlingEndpoint) {
                throw new RpcError(
                    "pimlico_simulateAssetChanges is not enabled",
                    ValidationErrors.InvalidFields
                )
            }
        }

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

        // Track logs by contract address
        const logsByAddress: Record<Address, LogType[]> = {}
        let netEthTransfers = 0n

        const callResult = await tevmClient.tevmCall({
            to: config.entrypointSimulationContract,
            data: callData,

            onStep: (step) => {
                const { opcode } = step

                // Handle ERC-20/ERC-721 Transfer events (LOG3)
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

                        // Get event data.
                        const offset = stack[stackLength - 1]
                        const size = stack[stackLength - 2]
                        const data = toHex(
                            memory.slice(
                                Number(offset),
                                Number(offset) + Number(size)
                            )
                        )

                        // Check if transfer touches userOp.sender
                        const from = getAddress(slice(topic1, 12, 32))
                        const to = getAddress(slice(topic2, 12, 32))
                        if (
                            from === userOperation.sender ||
                            to === userOperation.sender
                        ) {
                            const address = getAddress(
                                toHex(step.address.bytes, { size: 20 })
                            )

                            if (!logsByAddress[address]) {
                                logsByAddress[address] = []
                            }

                            logsByAddress[address].push({
                                address,
                                topics: [topic0, topic1, topic2],
                                data
                            })
                        }
                    } catch (err) {
                        rpcHandler.logger.error(
                            { err },
                            "Error processing LOG3 event"
                        )
                    }
                }

                // Handle ERC-1155 Transfer events (LOG4)
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

                        // Get event data (needed for both event types)
                        const offset = stack[stackLength - 1]
                        const size = stack[stackLength - 2]
                        const data = toHex(
                            memory.slice(
                                Number(offset),
                                Number(offset) + Number(size)
                            )
                        )

                        // Check if this is a TransferSingle event
                        if (
                            topic0 === TRANSFER_SINGLE_TOPIC_HASH ||
                            topic0 === TRANSFER_BATCH_TOPIC_HASH
                        ) {
                            // Check if transfer touches userOp.sender (from or to)
                            if (
                                getAddress(topic2) === userOperation.sender ||
                                getAddress(topic3) === userOperation.sender
                            ) {
                                const address = getAddress(
                                    toHex(step.address.bytes)
                                )

                                if (!logsByAddress[address]) {
                                    logsByAddress[address] = []
                                }

                                logsByAddress[address].push({
                                    address,
                                    topics: [topic0, topic1, topic2, topic3],
                                    data
                                })
                            }
                        }
                    } catch (err) {
                        rpcHandler.logger.error(
                            { err },
                            "Error processing LOG4 event for ERC-1155 transfers"
                        )
                    }
                }

                // Track ETH transfers via CALL opcode
                if (opcode.name === "CALL" || opcode.name === "CALLCODE") {
                    try {
                        const { stack, address } = step
                        const caller = getAddress(toHex(address.bytes))
                        const stackLength = stack.length

                        // Stack: [gas, address, value, argsOffset, argsSize, retOffset, retSize]
                        const to = getAddress(
                            toHex(stack[stackLength - 2], { size: 20 })
                        )
                        const value = stack[stackLength - 3]

                        // Only track calls that involve the userOp sender and have a non-zero value
                        if (
                            value > 0n &&
                            [to, caller].includes(userOperation.sender)
                        ) {
                            // If sender is sending ETH, subtract from balance
                            // If sender is receiving ETH, add to balance
                            const isSending = caller === userOperation.sender

                            if (isSending) {
                                netEthTransfers -= value
                            } else if (to === userOperation.sender) {
                                netEthTransfers += value
                            }
                        }
                    } catch (err) {
                        rpcHandler.logger.error(
                            { err },
                            "Error processing CALL opcode for ETH transfers"
                        )
                    }
                }

                // Track ETH transfers via CREATE/CREATE2 opcode
                if (opcode.name === "CREATE" || opcode.name === "CREATE2") {
                    try {
                        const { stack, address } = step
                        const caller = getAddress(toHex(address.bytes))
                        const stackLength = stack.length

                        // Stack: [value, offset, size, (salt)]
                        const value = stack[stackLength - 1]

                        // Only track calls that involve the userOp sender and have a non-zero value
                        if (value > 0n && caller == userOperation.sender) {
                            netEthTransfers -= value
                        }
                    } catch (err) {
                        rpcHandler.logger.error(
                            { err },
                            "Error processing CALL opcode for ETH transfers"
                        )
                    }
                }
            }
        })

        validateSimulateHandleOpResult({
            data: callResult.rawData,
            logger: rpcHandler.logger
        })

        // Process logs to extract asset changes
        const assetChanges: AssetChange[] = []

        // Process each address's logs
        await Promise.all(
            Object.entries(logsByAddress).map(
                async ([address, addressLogs]) => {
                    // Determine token type for this address
                    const tokenInfo = await getTokenInfo(
                        address as Address,
                        tevmClient,
                        rpcHandler.logger
                    )

                    if (!tokenInfo) {
                        rpcHandler.logger.debug(
                            { address },
                            "Could not determine token type for address"
                        )
                        return
                    }

                    // Parse logs based on token type
                    const tokenAssetChanges = await getAssetChangesFromLogs(
                        address as Address,
                        addressLogs,
                        tokenInfo,
                        userOperation.sender,
                        tevmClient
                    )

                    assetChanges.push(...tokenAssetChanges)
                }
            )
        )

        // Add ETH transfers to asset changes
        if (netEthTransfers !== 0n) {
            const balance = await tevmClient.getBalance({
                address: userOperation.sender
            })

            assetChanges.push({
                token: { tokenType: "NATIVE" as const },
                value: {
                    pre: balance,
                    post: balance + netEthTransfers,
                    diff: netEthTransfers
                }
            })
        }

        return { assetChanges }
    }
})
