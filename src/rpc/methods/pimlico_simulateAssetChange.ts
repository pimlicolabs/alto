import { createMethodHandler } from "../createMethodHandler"
import {
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
    decodeAbiParameters,
    encodeFunctionData,
    getAddress,
    toEventSelector,
    toHex
} from "viem"
import { isVersion06, toPackedUserOperation } from "../../utils/userop"
import type { AltoConfig } from "../../esm/createConfig"
import { SimulateHandleOpResult } from "../estimation/types"
import { Logger } from "pino"
import { InterpreterStep } from "tevm/evm"

// Event signatures for token standards
const TRANSFER_TOPIC_HASH = toEventSelector(
    "event Transfer(address indexed from, address indexed to, uint256 value)"
)

// ERC-20 approval event
const APPROVAL_TOPIC_HASH = toEventSelector(
    "event Approval(address indexed owner, address indexed spender, uint256 value)"
)

// ERC-721 specific approvals (not used yet, but defined for future use)
// const APPROVAL_FOR_ALL_TOPIC_HASH = toEventSelector(
//     "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)"
// )

// Type definitions for our logs
type TransferLog = {
    from: Address
    to: Address
    value: bigint
}

type ApprovalLog = {
    owner: Address
    spender: Address
    value: bigint
}

type NativeTransferLog = {
    from: Address
    to: Address
    value: bigint
}

type AssetChangeEvent = TransferLog | ApprovalLog | NativeTransferLog

function collectTransferLog({
    step,
    logger,
    logs
}: {
    step: InterpreterStep
    logger: Logger
    logs: Map<Address, AssetChangeEvent[]>
}): void {
    try {
        const { stack, memory } = step
        const stackLength = stack.length

        // Extract event data from the stack
        const offset = stack[stackLength - 1]
        const size = stack[stackLength - 2]
        const topic2 = stack[stackLength - 4] // from address
        const topic3 = stack[stackLength - 5] // to address

        // Extract addresses and value
        const from = getAddress(toHex(topic2))
        const to = getAddress(toHex(topic3))
        const contractAddress = getAddress(toHex(step.address.bytes))

        // Read value from memory
        const value = BigInt(
            toHex(memory.slice(Number(offset), Number(offset) + Number(size)))
        )

        // Record the transfer
        if (!logs.has(contractAddress)) {
            logs.set(contractAddress, [])
        }
        logs.get(contractAddress)!.push({ from, to, value })
    } catch (err) {
        logger.error({ err }, "Failed to collect transfer log")
        return
    }
}

function collectApprovalLog({
    step,
    logger,
    logs
}: {
    step: InterpreterStep
    logger: Logger
    logs: Map<Address, AssetChangeEvent[]>
}): void {
    try {
        const { stack, memory } = step
        const stackLength = stack.length

        const offset = stack[stackLength - 1]
        const size = stack[stackLength - 2]
        const topic2 = stack[stackLength - 4] // owner address
        const topic3 = stack[stackLength - 5] // spender address

        const owner = getAddress(toHex(topic2))
        const spender = getAddress(toHex(topic3))
        const contractAddress = getAddress(toHex(step.address.bytes))

        // Read value from memory
        const value = BigInt(
            toHex(memory.slice(Number(offset), Number(offset) + Number(size)))
        )

        // Record the transfer
        if (!logs.has(contractAddress)) {
            logs.set(contractAddress, [])
        }
        logs.get(contractAddress)!.push({ owner, spender, value })
    } catch (err) {
        if (logger) {
            logger.error({ err }, "Error processing approval event")
        }
        return
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

// NOTE: Endpoint to show the asset changes produced by a user operation (tracking userOp.sender's asset balance changes)
// According to the ERC-20 and ERC-721 spec, a event must be emitted for each transfer of a token.
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

        const logs: Map<Address, AssetChangeEvent[]> = new Map()

        const callResult = await tevmClient.tevmCall({
            to: config.entrypointSimulationContract,
            data: callData,

            onStep: (step) => {
                const { opcode } = step

                if (opcode.name === "LOG3") {
                    const { stack } = step

                    // Extract the event signature (topic1)
                    const topic1 = stack[stack.length - 3]
                    const eventSignature = toHex(topic1)

                    if (eventSignature === TRANSFER_TOPIC_HASH) {
                        collectTransferLog({
                            step,
                            logger: rpcHandler.logger,
                            logs: logs
                        })
                    }

                    if (eventSignature === APPROVAL_TOPIC_HASH) {
                        collectApprovalLog({
                            step,
                            logs,
                            logger: rpcHandler.logger
                        })
                    }
                }
            }
        })

        // Check for runtime reverts
        const simulationResult = decodeSimulateHandleOpResult({
            data: callResult.rawData,
            logger: rpcHandler.logger
        })

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

        // Aggregate asset change results
        //let assetChanges = []

        //for (const [assetAddress, transfers] of logs.entries()) {
        //    // Handle native token transfers
        //    if (assetAddress === zeroAddress) {
        //        const balanceChange = transfers.reduce((acc, transfer) => {
        //            if (transfer.from === userOp.sender) {
        //                return acc - transfer.value
        //            } else if (transfer.to === userOp.sender) {
        //                return acc + transfer.value
        //            }
        //            return acc
        //        }, 0n)

        //        if (balanceChange !== 0n) {
        //            assetChanges.push({
        //                type: "NATIVE",
        //                assetAddress,
        //                balanceChange,
        //                transfers
        //            })
        //        }

        //        continue
        //    }

        //    // Check token type
        //    const hasDecimals = await tevmClient.tevmCall({
        //        to: assetAddress,
        //        data: encodeFunctionData({
        //            abi: erc20Abi,
        //            functionName: "decimals",
        //            args: []
        //        })
        //    })

        //    const tokenType = hasDecimals.errors ? "ERC721" : "ERC20"

        //    if (tokenType === "ERC721") {
        //        // For ERC-721, track which tokens the user owns at the end of execution
        //        const receivedTokens = new Set<bigint>()
        //        const sentTokens = new Set<bigint>()

        //        for (const transfer of transfers) {
        //            const tokenId = transfer.value

        //            // Clear previous state to handle tokens transferred multiple times
        //            receivedTokens.delete(tokenId)
        //            sentTokens.delete(tokenId)

        //            // Add to appropriate set based on final direction
        //            if (transfer.to === userOp.sender) {
        //                receivedTokens.add(tokenId)
        //            } else if (transfer.from === userOp.sender) {
        //                sentTokens.add(tokenId)
        //            }
        //        }

        //        if (receivedTokens.size > 0 || sentTokens.size > 0) {
        //            assetChanges.push({
        //                type: "ERC721",
        //                assetAddress,
        //                tokenIdsReceived: Array.from(receivedTokens),
        //                tokenIdsSent: Array.from(sentTokens)
        //            })
        //        }
        //    } else {
        //        const balanceChange = transfers.reduce((acc, transfer) => {
        //            // sender recieved tokens
        //            if (transfer.to === userOp.sender) {
        //                return acc + transfer.value
        //            }

        //            // sender is sending tokens
        //            return acc - transfer.value
        //        }, 0n)

        //        // Only include tokens with non-zero net changes
        //        if (balanceChange !== 0n) {
        //            assetChanges.push({
        //                type: "ERC20",
        //                assetAddress,
        //                balanceChange
        //            })
        //        }
        //    }
        //}

        return {
            sender: userOp.sender,
            assetChanges
        }
    }
})
