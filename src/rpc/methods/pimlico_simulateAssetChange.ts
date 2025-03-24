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
    type: "TRANSFER"
    asset: Address
    from: Address
    to: Address
    value: bigint
}

type ApprovalLog = {
    type: "APPROVAL"
    asset: Address
    owner: Address
    spender: Address
    value: bigint
}

type NativeTransferLog = {
    type: "NATIVE_TRANSFER"
    from: Address
    to: Address
    value: bigint
}

type AssetChangeEvent = TransferLog | ApprovalLog | NativeTransferLog

/**
 * Collect native token (ETH) transfers by tracking opcodes that transfer ETH
 * - CALL/CALLCODE: direct ETH transfers to existing addresses
 */
function recordNativeTransfer({
    step,
    logger,
    logs
}: {
    step: InterpreterStep
    logger: Logger
    logs: AssetChangeEvent[]
}): void {
    try {
        const { stack } = step
        const stackLength = stack.length

        let value: bigint
        value = BigInt(toHex(stack[stackLength - 3]))

        if (value <= 0n) {
            return
        }

        const from = getAddress(toHex(step.address.bytes))
        const to = getAddress(toHex(stack[stackLength - 2]))

        logs.push({ type: "NATIVE_TRANSFER", from, to, value })
    } catch (err) {
        logger.error({ err }, "Error processing native transfer")
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

        const assetChangeEvents: AssetChangeEvent[] = []

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
                        logs: assetChangeEvents
                    })
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

        // Aggregate asset change results

        throw new RpcError("Not implemented")
    }
})
