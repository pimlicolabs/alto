import { createMethodHandler } from "../createMethodHandler"
import {
    AssetChangeEvent,
    EntryPointV07SimulationsAbi,
    ExecutionErrors,
    PimlicoEntryPointSimulationsAbi,
    RpcError,
    UserOperationV07,
    ValidationErrors,
    pimlicoSimulateAssetChangeSchema
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

// ERC-721 specific approvals (not used yet, but defined for future use)
//const APPROVAL_FOR_ALL_TOPIC_HASH = toEventSelector(
//    "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)"
//)

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
const tokenTypeCache = new Map<Address, "ERC-20" | "ERC-721">()

const checkTokenType = async (
    address: Address,
    tevmClient: PublicClient,
    tokenIdToCheck: bigint
): Promise<"ERC-20" | "ERC-721"> => {
    // Return cached token type if available
    const cached = tokenTypeCache.get(address)
    if (cached) return cached

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
            tokenTypeCache.set(address, "ERC-721")
            return "ERC-721"
        }

        // Try ERC-721 ownerOf as fallback check
        const ownerOf = await tevmClient.call({
            to: address,
            data: encodeFunctionData({
                abi: erc721Abi,
                functionName: "ownerOf",
                args: [tokenIdToCheck]
            })
        })

        if (ownerOf.data && isAddress(ownerOf.data)) {
            tokenTypeCache.set(address, "ERC-721")
            return "ERC-721"
        }

        throw new Error("Not an ERC-721 token")
    } catch {
        // Default to ERC-20 if ERC-721 checks fail
        tokenTypeCache.set(address, "ERC-20")
        return "ERC-20"
    }
}

function recordNativeTransfer({
    step,
    logger,
    tracker
}: {
    step: InterpreterStep
    logger: Logger
    tracker: AssetChangeEvent[]
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

// NOTE: Endpoint to show the asset changes that a user operation produces.
// According to the ERC-20 and ERC-721 spec, a event must be emitted for each transfer and approval of a token.
// We can collect any transfers by listening for these events when running the simulation.
export const pimlicoSimulateAssetChangeHandler = createMethodHandler({
    method: "pimlico_simulateAssetChange",
    schema: pimlicoSimulateAssetChangeSchema,
    handler: async ({ rpcHandler, params }) => {
        const { config } = rpcHandler
        const [userOperation, entryPoint, blockNumber] = params

        // Validations
        if (isVersion06(userOperation)) {
            throw new RpcError(
                "pimlico_simulateAssetChange is not supported for v0.6"
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

        // Create asset tracker to record and aggregate events
        const assetChanges: AssetChangeEvent[] = []
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
                        tracker: assetChanges
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
                    const decoded = decodeEventLog({
                        abi: erc20Abi,
                        eventName: "Transfer",
                        data,
                        topics: topics as [Hex, ...Hex[]]
                    })

                    const { value: valueOrTokenId, from, to } = decoded.args

                    const tokenType = await checkTokenType(
                        address,
                        tevmClient,
                        valueOrTokenId
                    )

                    if (tokenType === "ERC-721") {
                        assetChanges.push({
                            assetType: "ERC-721",
                            type: "transfer",
                            tokenAddress: address,
                            from,
                            to,
                            tokenId: valueOrTokenId
                        })
                    } else if (tokenType === "ERC-20") {
                        assetChanges.push({
                            assetType: "ERC-20",
                            type: "transfer",
                            tokenAddress: address,
                            from,
                            to,
                            value: valueOrTokenId
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
                    const decoded = decodeEventLog({
                        abi: erc20Abi,
                        eventName: "Approval",
                        data,
                        topics: topics as [Hex, ...Hex[]]
                    })

                    const {
                        value: valueOrTokenId,
                        owner,
                        spender
                    } = decoded.args

                    const tokenType = await checkTokenType(
                        address,
                        tevmClient,
                        valueOrTokenId
                    )

                    if (tokenType === "ERC-721") {
                        assetChanges.push({
                            assetType: "ERC-721",
                            type: "approval",
                            tokenAddress: address,
                            owner,
                            spender,
                            tokenId: valueOrTokenId
                        })
                    } else if (tokenType === "ERC-20") {
                        assetChanges.push({
                            assetType: "ERC-20",
                            type: "approval",
                            tokenAddress: address,
                            owner,
                            spender,
                            value: valueOrTokenId
                        })
                    }
                } catch (err) {
                    rpcHandler.logger.error(
                        { err },
                        "Error processing Approval event"
                    )
                }
            }
        }

        return {
            assetChanges
        }
    }
})
