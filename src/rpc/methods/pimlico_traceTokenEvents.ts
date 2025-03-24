import { createMethodHandler } from "../createMethodHandler"
import {
    TokenEvents,
    EntryPointV07SimulationsAbi,
    ExecutionErrors,
    PimlicoEntryPointSimulationsAbi,
    RpcError,
    UserOperationV07,
    ValidationErrors,
    pimlicoTraceTokenEventsSchema
} from "@alto/types"
import {
    decodeDelegateAndRevertResponse,
    getSimulateHandleOpResult
} from "../estimation/gasEstimationsV07"
import { createMemoryClient, http } from "tevm"
import { optimism as tevmOptimism } from "tevm/common"
import {
    Address,
    Hex,
    PublicClient,
    decodeAbiParameters,
    decodeEventLog,
    encodeFunctionData,
    erc20Abi,
    erc721Abi,
    getAddress,
    hexToBool,
    isAddress,
    parseAbi,
    toEventSelector,
    toHex
} from "viem"
import { isVersion06, toPackedUserOperation } from "../../utils/userop"
import type { AltoConfig } from "../../createConfig"
import { SimulateHandleOpResult } from "../estimation/types"
import { Logger } from "pino"
import { InterpreterStep } from "tevm/evm"

// ERC-721 specific approval for all event
const APPROVAL_FOR_ALL_TOPIC_HASH = toEventSelector(
    "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)"
)

// Event signatures for token standards
const TRANSFER_TOPIC_HASH = toEventSelector(
    "event Transfer(address indexed from, address indexed to, uint256 value)"
)

// ERC-20 approval event
const APPROVAL_TOPIC_HASH = toEventSelector(
    "event Approval(address indexed owner, address indexed spender, uint256 value)"
)

// ERC-165 interface ID for ERC-721
const ERC721_INTERFACE_ID = "0x80ac58cd"

// Combined cache for token type and metadata
type TokenInfo = {
    type: "ERC-20" | "ERC-721"
    metadata: {
        name?: string
        symbol?: string
        decimals?: number
    }
}

const tokenInfoCache = new Map<Address, TokenInfo>()

/**
 * Get token type and metadata in a single call
 */
const getTokenInfo = async (
    address: Address,
    tevmClient: PublicClient,
    logger: Logger
): Promise<TokenInfo> => {
    // Return cached token info if available
    const cached = tokenInfoCache.get(address)
    if (cached) return cached

    // Determine token type first
    let tokenType: "ERC-20" | "ERC-721"

    try {
        // Check if token supports ERC-721 interface via ERC-165
        const erc165Abi = parseAbi([
            "function supportsInterface(bytes4) returns (bool)"
        ])

        const supportsErc721 = await tevmClient.call({
            to: address,
            data: encodeFunctionData({
                abi: erc165Abi,
                functionName: "supportsInterface",
                args: [ERC721_INTERFACE_ID]
            })
        })

        if (hexToBool(supportsErc721.data || "0x0")) {
            tokenType = "ERC-721"
        } else {
            // Try ERC-721 ownerOf as fallback check
            try {
                const ownerOf = await tevmClient.call({
                    to: address,
                    data: encodeFunctionData({
                        abi: erc721Abi,
                        functionName: "ownerOf",
                        args: [1n]
                    })
                })

                if (ownerOf.data && isAddress(ownerOf.data)) {
                    tokenType = "ERC-721"
                } else {
                    tokenType = "ERC-20" // Default to ERC-20
                }
            } catch {
                tokenType = "ERC-20" // Default to ERC-20 if ownerOf call fails
            }
        }
    } catch (err) {
        // Default to ERC-20 if ERC-721 checks fail
        tokenType = "ERC-20"
        logger.debug(
            { err },
            "Failed to determine token type, defaulting to ERC-20"
        )
    }

    // Now fetch the metadata based on the determined token type
    const metadata: { name?: string; symbol?: string; decimals?: number } = {}

    // Fetch common metadata fields: name and symbol
    try {
        // Try to get name
        try {
            const nameResult = await tevmClient.call({
                to: address,
                data: encodeFunctionData({
                    abi: tokenType === "ERC-20" ? erc20Abi : erc721Abi,
                    functionName: "name"
                })
            })
            if (nameResult.data) {
                const [name] = decodeAbiParameters(
                    [{ type: "string" }],
                    nameResult.data
                )
                metadata.name = name
            }
        } catch (err) {
            logger.debug({ err }, `Error getting ${tokenType} token name`)
        }

        // Try to get symbol
        try {
            const symbolResult = await tevmClient.call({
                to: address,
                data: encodeFunctionData({
                    abi: tokenType === "ERC-20" ? erc20Abi : erc721Abi,
                    functionName: "symbol"
                })
            })
            if (symbolResult.data) {
                const [symbol] = decodeAbiParameters(
                    [{ type: "string" }],
                    symbolResult.data
                )
                metadata.symbol = symbol
            }
        } catch (err) {
            logger.debug({ err }, `Error getting ${tokenType} token symbol`)
        }

        // For ERC-20 tokens, also fetch decimals
        if (tokenType === "ERC-20") {
            try {
                const decimalsResult = await tevmClient.call({
                    to: address,
                    data: encodeFunctionData({
                        abi: erc20Abi,
                        functionName: "decimals"
                    })
                })
                if (decimalsResult.data) {
                    const [decimals] = decodeAbiParameters(
                        [{ type: "uint8" }],
                        decimalsResult.data
                    )
                    metadata.decimals = Number(decimals)
                }
            } catch (err) {
                logger.debug({ err }, "Error getting ERC-20 token decimals")
            }
        }
    } catch (err) {
        logger.error({ err }, `Error fetching ${tokenType} token metadata`)
    }

    // Create and cache the token info
    const tokenInfo: TokenInfo = {
        type: tokenType,
        metadata: metadata
    }

    tokenInfoCache.set(address, tokenInfo)
    return tokenInfo
}

function recordNativeTransfer({
    step,
    logger,
    tracker
}: {
    step: InterpreterStep
    logger: Logger
    tracker: TokenEvents[]
}): void {
    try {
        const { stack } = step
        const stackLength = stack.length

        const value = BigInt(toHex(stack[stackLength - 3]))
        const from = getAddress(toHex(step.address.bytes))
        const to = getAddress(toHex(stack[stackLength - 2], { size: 20 }))

        if (value > 0n) {
            tracker.push({
                assetType: "NATIVE",
                type: "transfer",
                from,
                to,
                value
            })
        }
    } catch (err) {
        logger.error({ err }, "Error processing native transfer")
    }
}

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

function decodeSimulateHandleOpResult({
    data,
    logger
}: { data: Hex; logger: Logger }): SimulateHandleOpResult {
    // Decode simulation result
    try {
        const [result] = decodeAbiParameters(
            [{ name: "ret", type: "bytes[]" }],
            data
        )

        const simulateHandleOpResult = result[0]

        const delegateAndRevertResponse = decodeDelegateAndRevertResponse(
            simulateHandleOpResult
        )

        return getSimulateHandleOpResult(delegateAndRevertResponse)
    } catch (err) {
        logger.error({ err }, "Failed to decode simulation result")
        throw new RpcError(
            "Failed to decode simulation result",
            ValidationErrors.SimulateValidation
        )
    }
}

// NOTE: Endpoint to trace token-related events that a user operation produces.
// According to the ERC-20 and ERC-721 spec, a event must be emitted for each transfer and approval of a token.
// We can collect any transfers by listening for these events when running the simulation.
export const pimlicoTraceTokenEventsHandler = createMethodHandler({
    method: "pimlico_traceTokenEvents",
    schema: pimlicoTraceTokenEventsSchema,
    handler: async ({ rpcHandler, params }) => {
        const { config } = rpcHandler
        const [userOperation, entryPoint, blockNumber] = params

        // Validations
        if (isVersion06(userOperation)) {
            throw new RpcError(
                "pimlico_traceTokenEvents is not supported for v0.6"
            )
        }

        if (!config.entrypointSimulationContract) {
            throw new RpcError("Missing entryPoint simulations contract")
        }

        const tevmClient = await setupTevm(config, blockNumber)

        // Create simulation calldata + call tevmCall with tracing
        const userOp = {
            ...userOperation,
            // Set zero gasLimits to skip prefund checks
            maxFeePerGas: 0n,
            maxPriorityFeePerGas: 0n
        } as UserOperationV07
        const callData = encodeFunctionData({
            abi: PimlicoEntryPointSimulationsAbi,
            functionName: "simulateEntryPoint",
            args: [
                entryPoint,
                [
                    encodeFunctionData({
                        abi: EntryPointV07SimulationsAbi,
                        functionName: "simulateHandleOp",
                        args: [toPackedUserOperation(userOp)]
                    })
                ]
            ]
        })

        // Create token events tracker to record and aggregate events
        const tokenEvents: TokenEvents[] = []
        const logs: { address: Address; topics: Hex[]; data: Hex }[] = []

        const callResult = await tevmClient.tevmCall({
            to: config.entrypointSimulationContract,
            data: callData,

            onStep: (step) => {
                const { opcode } = step

                // These are the only opcodes that can transfer ETH
                if (
                    opcode.name === "CALL" ||
                    opcode.name === "CALLCODE"
                    //opcode.name === "CREATE" ||
                    //opcode.name === "CREATE2"
                ) {
                    recordNativeTransfer({
                        step,
                        logger: rpcHandler.logger,
                        tracker: tokenEvents
                    })
                }

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
                            address: toHex(step.address.bytes),
                            data,
                            topics: [topic0, topic1, topic2]
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
                            address: toHex(step.address.bytes),
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

        // Check for runtime reverts.
        const simulationResult = decodeSimulateHandleOpResult({
            data: callResult.rawData,
            logger: rpcHandler.logger
        })

        // If execution failed, bubble up error.
        if (simulationResult.result === "failed") {
            const { data } = simulationResult
            let errorCode: number = ExecutionErrors.UserOperationReverted

            if (data.toString().includes("AA23")) {
                errorCode = ValidationErrors.SimulateValidation
            }

            throw new RpcError(
                `UserOperation reverted during simulation with reason: ${data}`,
                errorCode
            )
        }

        // Parse the logs from the transaction receipt
        // Process ERC-20 Transfer and Approval events from logs
        for (const log of logs) {
            const { address, topics, data } = log

            // Transfer events (both ERC-20 and ERC-721 use the same event signature)
            if (topics[0] === TRANSFER_TOPIC_HASH) {
                try {
                    const tokenInfo = await getTokenInfo(
                        address,
                        tevmClient,
                        rpcHandler.logger
                    )

                    if (tokenInfo.type === "ERC-721") {
                        const decoded = decodeEventLog({
                            abi: erc721Abi,
                            eventName: "Transfer",
                            data,
                            topics: topics as [Hex, ...Hex[]]
                        })

                        const { tokenId, from, to } = decoded.args

                        tokenEvents.push({
                            assetType: "ERC-721",
                            type: "transfer",
                            tokenAddress: address,
                            from,
                            to,
                            tokenId,
                            name: tokenInfo.metadata.name,
                            symbol: tokenInfo.metadata.symbol
                        })
                    } else if (tokenInfo.type === "ERC-20") {
                        const decoded = decodeEventLog({
                            abi: erc20Abi,
                            eventName: "Transfer",
                            data,
                            topics: topics as [Hex, ...Hex[]]
                        })

                        const { value, from, to } = decoded.args

                        tokenEvents.push({
                            assetType: "ERC-20",
                            type: "transfer",
                            tokenAddress: address,
                            from,
                            to,
                            value,
                            name: tokenInfo.metadata.name,
                            symbol: tokenInfo.metadata.symbol,
                            decimals: tokenInfo.metadata.decimals
                        })
                    }
                } catch (err) {
                    rpcHandler.logger.error(
                        { err },
                        "Error processing Transfer event"
                    )
                }
            }

            // Approval events (both ERC-20 and ERC-721 use the same event signature)
            if (topics[0] === APPROVAL_TOPIC_HASH) {
                try {
                    const tokenInfo = await getTokenInfo(
                        address,
                        tevmClient,
                        rpcHandler.logger
                    )

                    if (tokenInfo.type === "ERC-721") {
                        const decoded = decodeEventLog({
                            abi: erc721Abi,
                            eventName: "Approval",
                            data,
                            topics: topics as [Hex, ...Hex[]]
                        })

                        const { tokenId, owner, spender } = decoded.args

                        tokenEvents.push({
                            assetType: "ERC-721",
                            type: "approval",
                            tokenAddress: address,
                            owner,
                            spender,
                            tokenId,
                            name: tokenInfo.metadata.name,
                            symbol: tokenInfo.metadata.symbol
                        })
                    } else if (tokenInfo.type === "ERC-20") {
                        const decoded = decodeEventLog({
                            abi: erc20Abi,
                            eventName: "Approval",
                            data,
                            topics: topics as [Hex, ...Hex[]]
                        })

                        const { value, owner, spender } = decoded.args

                        tokenEvents.push({
                            assetType: "ERC-20",
                            type: "approval",
                            tokenAddress: address,
                            owner,
                            spender,
                            value,
                            name: tokenInfo.metadata.name,
                            symbol: tokenInfo.metadata.symbol,
                            decimals: tokenInfo.metadata.decimals
                        })
                    }
                } catch (err) {
                    rpcHandler.logger.error(
                        { err },
                        "Error processing Approval event"
                    )
                }
            }

            // ERC-721 ApprovalForAll events
            if (topics[0] === APPROVAL_FOR_ALL_TOPIC_HASH) {
                try {
                    const tokenInfo = await getTokenInfo(
                        address,
                        tevmClient,
                        rpcHandler.logger
                    )

                    if (tokenInfo.type === "ERC-721") {
                        const decoded = decodeEventLog({
                            abi: erc721Abi,
                            eventName: "ApprovalForAll",
                            data,
                            topics: topics as [Hex, ...Hex[]]
                        })

                        const { owner, operator, approved } = decoded.args

                        tokenEvents.push({
                            assetType: "ERC-721",
                            type: "approvalForAll",
                            tokenAddress: address,
                            owner,
                            operator,
                            approved,
                            name: tokenInfo.metadata.name,
                            symbol: tokenInfo.metadata.symbol
                        })
                    }
                } catch (err) {
                    rpcHandler.logger.error(
                        { err },
                        "Error processing ApprovalForAll event"
                    )
                }
            }
        }

        return {
            tokenEvents
        }
    }
})
