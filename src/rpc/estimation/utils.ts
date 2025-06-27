import {
    type Hex,
    decodeErrorResult,
    parseAbi,
    type StateOverride,
    BaseError,
    ContractFunctionRevertedError,
    ContractFunctionExecutionError,
    getAbiItem
} from "viem"
import { getAuthorizationStateOverrides, type Logger } from "@alto/utils"
import type {
    StateOverrides,
    UserOperationV06,
    UserOperationV07
} from "@alto/types"
import { toViemStateOverrides } from "../../utils/toViemStateOverrides"
import type { AltoConfig } from "../../createConfig"
import { ValidationErrors, executionResultSchema } from "@alto/types"
import type { SimulateHandleOpResult } from "../estimation/types"
import { entryPoint06Abi } from "viem/account-abstraction"

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

export function prepareStateOverride({
    userOperations,
    queuedUserOperations,
    stateOverrides,
    config
}: {
    userOperations: (UserOperationV06 | UserOperationV07)[]
    queuedUserOperations: (UserOperationV06 | UserOperationV07)[]
    stateOverrides?: StateOverrides
    config: Pick<AltoConfig, "balanceOverride" | "codeOverrideSupport">
}): StateOverride | undefined {
    const stateOverride = getAuthorizationStateOverrides({
        userOperations: [...queuedUserOperations, ...userOperations],
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

export function decodeSimulateHandleOpError(
    error: unknown,
    logger: Logger
): SimulateHandleOpResult {
    // Check if it's a BaseError with ContractFunctionRevertedError
    if (!(error instanceof BaseError)) {
        logger.warn("Not a BaseError")
        return {
            result: "failed",
            data: "Unknown error, could not parse simulate validation result.",
            code: ValidationErrors.SimulateValidation
        }
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
                code: ValidationErrors.SimulateValidation
            }
        }

        if (!error.data?.args) {
            logger.warn("Missing args")
            return {
                result: "failed",
                data: "Unknown error, could not parse simulate validation result.",
                code: ValidationErrors.SimulateValidation
            }
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
            return {
                result: "failed",
                data: "Unknown error, could not parse simulate validation result.",
                code: ValidationErrors.SimulateValidation
            }
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
        } catch (decodeError) {
            logger.warn({ rawRevertBytes }, "Failed to decode raw revert bytes")
            return {
                result: "failed",
                data: "Unknown error, could not parse simulate validation result.",
                code: ValidationErrors.SimulateValidation
            }
        }
    } else {
        return {
            result: "failed",
            data: "Unknown error, could not parse simulate validation result.",
            code: ValidationErrors.SimulateValidation
        }
    }

    switch (errorName) {
        case "FailedOp":
            return {
                result: "failed",
                data: args[1] as string,
                code: ValidationErrors.SimulateValidation
            }

        case "FailedOpWithRevert":
            return {
                result: "failed",
                data: `${args[1]} ${parseFailedOpWithRevert(args[2] as Hex)}`,
                code: ValidationErrors.SimulateValidation
            }

        case "CallPhaseReverted":
            return {
                result: "failed",
                data: args[0] as Hex,
                code: ValidationErrors.SimulateValidation
            }

        case "Error":
            return {
                result: "failed",
                data: args[0] as string,
                code: ValidationErrors.SimulateValidation
            }

        // 0.6 handleOp reverts with ExecutionResult if successful
        case "ExecutionResult":
            const parsedExecutionResult = executionResultSchema.parse(args)
            return {
                result: "execution",
                data: {
                    executionResult: parsedExecutionResult
                }
            }

        default:
            logger.warn(
                { errorName },
                "Unknown ContractFunctionRevertedError name"
            )
            return {
                result: "failed",
                data: "Unknown error, could not parse simulate validation result.",
                code: ValidationErrors.SimulateValidation
            }
    }
}
