import { createMethodHandler } from "../../createMethodHandler"
import { RpcError, pimlicoSimulateAssetChangesSchema } from "@alto/types"
import { createMemoryClient, http } from "tevm"
import { optimism as tevmOptimism } from "tevm/common"
import { getAddress, toEventSelector, toHex, decodeAbiParameters } from "viem"
import { isVersion06 } from "../../../utils/userop"
import type { AltoConfig } from "../../../createConfig"
import {
    getSimulateHandleOpCallData,
    validateSimulateHandleOpResult
} from "./userOpSimulationHelper"
import { getTokenInfo } from "./getTokenMetadata"

// Both ERC-20 and ERC-721 use the same event signature
const TRANSFER_TOPIC_HASH = toEventSelector(
    "event Transfer(address indexed from, address indexed to, uint256 value)"
)

// ERC-1155 TransferSingle event
const TRANSFER_SINGLE_TOPIC_HASH = toEventSelector(
    "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)"
)

// ERC-1155 TransferBatch event
const TRANSFER_BATCH_TOPIC_HASH = toEventSelector(
    "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)"
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
                } else if (opcode.name === "LOG4") {
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
                        if (topic0 === TRANSFER_SINGLE_TOPIC_HASH) {
                            // Check if transfer touches userOp.sender (from or to)
                            if (
                                getAddress(topic2) === userOperation.sender ||
                                getAddress(topic3) === userOperation.sender
                            ) {
                                logs.push({
                                    address: getAddress(
                                        toHex(step.address.bytes)
                                    ),
                                    topics: [topic0, topic1, topic2, topic3],
                                    data
                                })
                            }
                        }
                        // Check if this is a TransferBatch event
                        else if (topic0 === TRANSFER_BATCH_TOPIC_HASH) {
                            // Check if transfer touches userOp.sender (from or to)
                            if (
                                getAddress(topic2) === userOperation.sender ||
                                getAddress(topic3) === userOperation.sender
                            ) {
                                logs.push({
                                    address: getAddress(
                                        toHex(step.address.bytes)
                                    ),
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
            }
        })

        validateSimulateHandleOpResult({
            data: callResult.rawData,
            logger: rpcHandler.logger
        })

        // Process logs to extract asset changes
        const assetChanges = []

        for (const log of logs) {
            const { address, topics, data } = log
            const eventSignature = topics[0]

            try {
                // Handle ERC-20/ERC-721 transfers
                if (eventSignature === TRANSFER_TOPIC_HASH) {
                    const from = getAddress(topics[1])
                    const to = getAddress(topics[2])
                    const value = decodeAbiParameters(
                        [{ type: "uint256" }],
                        data
                    )[0]

                    const tokenInfo = await getTokenInfo(
                        address,
                        tevmClient,
                        rpcHandler.logger
                    )

                    if (tokenInfo) {
                        if (tokenInfo.type === "ERC-20") {
                            assetChanges.push({
                                token: {
                                    tokenType: "ERC-20",
                                    address,
                                    ...tokenInfo.metadata
                                },
                                value: {
                                    // If sender is sending tokens, value is negative
                                    // If sender is receiving tokens, value is positive
                                    diff:
                                        from === userOperation.sender
                                            ? -value
                                            : value,
                                    pre: 0n, // We don't have pre/post balances in this simulation
                                    post: 0n
                                }
                            })
                        } else if (tokenInfo.type === "ERC-721") {
                            assetChanges.push({
                                token: {
                                    tokenType: "ERC-721",
                                    address,
                                    tokenId: value,
                                    ...tokenInfo.metadata
                                },
                                value: {
                                    diff:
                                        from === userOperation.sender
                                            ? -1n
                                            : 1n,
                                    pre: 0n,
                                    post: 0n
                                }
                            })
                        }
                    }
                }
                // Handle ERC-1155 TransferSingle
                else if (eventSignature === TRANSFER_SINGLE_TOPIC_HASH) {
                    const operator = getAddress(topics[1])
                    const from = getAddress(topics[2])
                    const to = getAddress(topics[3])

                    // Decode the token ID and value from the data
                    const [id, amount] = decodeAbiParameters(
                        [{ type: "uint256" }, { type: "uint256" }],
                        data
                    )

                    const tokenInfo = await getTokenInfo(
                        address,
                        tevmClient,
                        rpcHandler.logger
                    )

                    if (tokenInfo && tokenInfo.type === "ERC-1155") {
                        assetChanges.push({
                            token: {
                                tokenType: "ERC-1155",
                                address,
                                tokenId: id,
                                ...tokenInfo.metadata
                            },
                            value: {
                                diff:
                                    from === userOperation.sender
                                        ? -amount
                                        : amount,
                                pre: 0n,
                                post: 0n
                            }
                        })
                    }
                }
                // Handle ERC-1155 TransferBatch
                else if (eventSignature === TRANSFER_BATCH_TOPIC_HASH) {
                    const operator = getAddress(topics[1])
                    const from = getAddress(topics[2])
                    const to = getAddress(topics[3])

                    // Decode the token IDs and values from the data
                    const [ids, amounts] = decodeAbiParameters(
                        [{ type: "uint256[]" }, { type: "uint256[]" }],
                        data
                    )

                    const tokenInfo = await getTokenInfo(
                        address,
                        tevmClient,
                        rpcHandler.logger
                    )

                    if (tokenInfo && tokenInfo.type === "ERC-1155") {
                        // Add an asset change for each token ID in the batch
                        for (let i = 0; i < ids.length; i++) {
                            assetChanges.push({
                                token: {
                                    tokenType: "ERC-1155",
                                    address,
                                    tokenId: ids[i],
                                    ...tokenInfo.metadata
                                },
                                value: {
                                    diff:
                                        from === userOperation.sender
                                            ? -amounts[i]
                                            : amounts[i],
                                    pre: 0n,
                                    post: 0n
                                }
                            })
                        }
                    }
                }
            } catch (err) {
                rpcHandler.logger.error(
                    { err, log },
                    "Error processing log for asset changes"
                )
            }
        }

        return { assetChanges }
    }
})
