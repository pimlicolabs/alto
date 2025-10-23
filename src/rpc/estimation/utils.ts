import type {
    StateOverrides,
    UserOperation06,
    UserOperation07
} from "@alto/types"
import { ERC7769Errors, executionResultSchema } from "@alto/types"
import {
    type Logger,
    deepHexlify,
    getAuthorizationStateOverrides
} from "@alto/utils"
import {
    type Address,
    BaseError,
    ContractFunctionExecutionError,
    ContractFunctionRevertedError,
    type Hex,
    type StateOverride,
    decodeErrorResult,
    getAbiItem,
    keccak256,
    parseAbi,
    toHex
} from "viem"
import { entryPoint06Abi } from "viem/account-abstraction"
import entryPointOverride from "../../contracts/EntryPointGasEstimationOverride.sol/EntryPointGasEstimationOverride06.json" with {
    type: "json"
}
import type { AltoConfig } from "../../createConfig"
import type { GasPriceManager } from "../../handlers/gasPriceManager"
import { getSenderCreatorOverride } from "../../utils/entryPointOverrides"
import { toViemStateOverrides } from "../../utils/toViemStateOverrides"
import type { SimulateHandleOpResult } from "../estimation/types"

export function parseFailedOpWithRevert(data: Hex) {
    try {
        const decoded = decodeErrorResult({
            abi: parseAbi(["error Error(string)", "error Panic(uint256)"]),
            data
        })

        if (decoded.errorName === "Error") {
            return decoded.args[0]
        }

        if (decoded.errorName === "Panic") {
            // from https://docs.soliditylang.org/en/v0.8.0/control-structures.html
            const panicCodes: { [key: number]: string } = {
                1: "assert(false)",
                17: "arithmetic overflow/underflow",
                18: "divide by zero",
                33: "invalid enum value",
                34: "storage byte array that is incorrectly encoded",
                49: ".pop() on an empty array.",
                50: "array sout-of-bounds or negative index",
                65: "memory overflow",
                81: "zero-initialized variable of internal function type"
            }

            const [code] = decoded.args
            return panicCodes[Number(code)] ?? `${code}`
        }
    } catch {}

    return data
}

// Helper function that adds EIP-7702 overrides if needed, and converts to viem format.
export function prepareStateOverride({
    userOps,
    queuedUserOps,
    stateOverrides,
    config
}: {
    userOps: (UserOperation06 | UserOperation07)[]
    queuedUserOps: (UserOperation06 | UserOperation07)[]
    stateOverrides?: StateOverrides
    config: Pick<AltoConfig, "balanceOverride" | "codeOverrideSupport">
}): StateOverride | undefined {
    const stateOverride = getAuthorizationStateOverrides({
        userOps: [...queuedUserOps, ...userOps],
        stateOverrides
    })

    // Remove state override if not supported by network.
    if (!config.balanceOverride && !config.codeOverrideSupport) {
        return undefined
    }

    return toViemStateOverrides(stateOverride)
}

export const simulationErrors = parseAbi([
    "error Error(string)",
    "error FailedOp(uint256 opIndex, string reason)",
    "error FailedOpWithRevert(uint256 opIndex, string reason, bytes inner)",
    "error CallPhaseReverted(bytes reason)"
])

// Returns error code based on EntryPoint's AA error message.
export const toErc7769Code = (entryPointError: string) => {
    if (entryPointError.includes("AA24") || entryPointError.includes("AA34")) {
        return ERC7769Errors.InvalidSignature
    }

    if (entryPointError.includes("AA31")) {
        return ERC7769Errors.PaymasterDepositTooLow
    }

    if (entryPointError.includes("AA32")) {
        return ERC7769Errors.ExpiresShortly
    }

    if (
        entryPointError.includes("AA30") ||
        entryPointError.includes("AA33") ||
        entryPointError.includes("AA36")
    ) {
        return ERC7769Errors.SimulatePaymasterValidation
    }

    return ERC7769Errors.SimulateValidation
}

export function decodeSimulateHandleOpError(
    error: unknown,
    logger: Logger
): SimulateHandleOpResult {
    // Check if it's a BaseError with ContractFunctionRevertedError
    if (!(error instanceof BaseError)) {
        logger.warn("Not a BaseError")
        throw new Error(
            "Unknown error, could not parse simulate validation result."
        )
    }

    let errorName: string
    let args: readonly unknown[]

    const contractFunctionRevertedError = error.walk(
        (e) => e instanceof ContractFunctionRevertedError
    ) as ContractFunctionRevertedError

    // Indicates that the RPC reverted with non standard format
    // in this case we try to find raw revert bytes and manually decode
    const contractFunctionExecutionError = error.walk(
        (e) => e instanceof ContractFunctionExecutionError
    ) as ContractFunctionExecutionError

    if (contractFunctionRevertedError) {
        const error = contractFunctionRevertedError

        if (!error.data?.args && error.raw === "0x") {
            return {
                result: "failed",
                data: "Sender has no code or factory not deployed",
                code: ERC7769Errors.SimulateValidation
            }
        }

        if (!error.data?.args) {
            logger.warn("Missing args")
            throw new Error(
                "Unknown error, could not parse simulate validation result."
            )
        }

        errorName = error.data.errorName
        args = error.data.args
    } else if (contractFunctionExecutionError) {
        // Manually decode revert bytes
        let rawRevertBytes: Hex | undefined

        error.walk((e: any) => {
            if (typeof e?.data === "string") {
                const hexMatch = e.data.match(/(0x[a-fA-F0-9]+)/)
                if (hexMatch) {
                    rawRevertBytes = hexMatch[0]
                    return true // Stop walking
                }
            }
            return false
        })

        if (!rawRevertBytes) {
            logger.warn("Failed to find raw revert bytes")
            throw new Error(
                "Unknown error, could not parse simulate validation result."
            )
        }

        try {
            const decoded = decodeErrorResult({
                abi: [
                    getAbiItem({
                        abi: entryPoint06Abi,
                        name: "ExecutionResult"
                    }),
                    ...simulationErrors
                ],
                data: rawRevertBytes
            })

            errorName = decoded.errorName
            args = decoded.args || []
        } catch {
            logger.warn({ rawRevertBytes }, "Failed to decode raw revert bytes")
            throw new Error(
                "Unknown error, could not parse simulate validation result."
            )
        }
    } else {
        logger.warn(
            { err: contractFunctionRevertedError },
            "Unknown error, could not parse simulate validation result."
        )
        throw new Error(
            "Unknown error, could not parse simulate validation result."
        )
    }

    switch (errorName) {
        case "FailedOp": {
            const errorMessage = args[1] as string
            return {
                result: "failed",
                data: errorMessage,
                code: toErc7769Code(errorMessage)
            }
        }

        case "FailedOpWithRevert": {
            const errorMessage = args[1] as string
            const revertReason = parseFailedOpWithRevert(args[2] as Hex)
            return {
                result: "failed",
                data: `${errorMessage} ${revertReason}`,
                code: toErc7769Code(errorMessage)
            }
        }

        case "CallPhaseReverted": {
            const errorMessage = args[0] as string
            return {
                result: "failed",
                data: errorMessage,
                code: ERC7769Errors.UserOperationReverted
            }
        }

        case "Error": {
            const errorMessage = args[0] as string
            return {
                result: "failed",
                data: errorMessage,
                code: toErc7769Code(errorMessage)
            }
        }

        // 0.6 handleOp reverts with ExecutionResult if successful
        case "ExecutionResult": {
            const parsedExecutionResult = executionResultSchema.parse(args)
            return {
                result: "execution",
                data: {
                    executionResult: parsedExecutionResult
                }
            }
        }

        default: {
            logger.warn(
                { errorName },
                "Unknown ContractFunctionRevertedError name"
            )
            throw new Error(
                "Unknown error, could not parse simulate validation result."
            )
        }
    }
}

// Helper function to prepare state overrides for v0.6 simulations
export async function prepareSimulationOverrides06({
    userOp,
    entryPoint,
    userStateOverrides = {},
    useCodeOverride,
    config
}: {
    userOp: UserOperation06
    entryPoint: Address
    userStateOverrides?: StateOverrides
    useCodeOverride: boolean
    config: Pick<AltoConfig, "codeOverrideSupport" | "balanceOverride">
}): Promise<StateOverride | undefined> {
    const mergedStateOverrides = { ...userStateOverrides }

    // EntryPoint simulation v0.6 code specific overrides
    if (config.codeOverrideSupport && useCodeOverride) {
        const senderCreatorOverride = getSenderCreatorOverride(entryPoint)

        mergedStateOverrides[entryPoint] = {
            ...deepHexlify(mergedStateOverrides?.[entryPoint] || {}),
            stateDiff: {
                ...(mergedStateOverrides[entryPoint]?.stateDiff || {}),
                [senderCreatorOverride.slot]: senderCreatorOverride.value
            },
            code: entryPointOverride.deployedBytecode.object as Hex
        }
    }

    return prepareStateOverride({
        userOps: [userOp],
        queuedUserOps: [], // Queued operations are not supported for EntryPoint v0.6
        stateOverrides: mergedStateOverrides,
        config
    })
}

// Helper function to prepare state overrides for v0.7 simulations
export async function prepareSimulationOverrides07({
    userOp,
    queuedUserOps,
    entryPoint,
    gasPriceManager,
    userStateOverrides = {},
    config
}: {
    userOp: UserOperation07
    queuedUserOps: UserOperation07[]
    entryPoint: Address
    gasPriceManager: GasPriceManager
    userStateOverrides?: StateOverrides
    config: Pick<AltoConfig, "codeOverrideSupport" | "balanceOverride">
}): Promise<StateOverride | undefined> {
    const mergedStateOverrides = { ...userStateOverrides }

    // Add baseFee override for v0.7 EntryPoint simulations
    if (config.codeOverrideSupport) {
        const baseFee = await gasPriceManager.getBaseFee()
        if (baseFee > 0n) {
            const slot = keccak256(toHex("BLOCK_BASE_FEE_PER_GAS"))
            const value = toHex(baseFee, { size: 32 })

            mergedStateOverrides[entryPoint] = {
                ...deepHexlify(mergedStateOverrides?.[entryPoint] || {}),
                stateDiff: {
                    ...(mergedStateOverrides[entryPoint]?.stateDiff || {}),
                    [slot]: value
                }
            }
        }
    }

    return prepareStateOverride({
        userOps: [userOp],
        queuedUserOps,
        stateOverrides: mergedStateOverrides,
        config
    })
}
