import { type Hex, decodeErrorResult, parseAbi, type StateOverride } from "viem"
import { getAuthorizationStateOverrides } from "@alto/utils"
import type { StateOverrides, UserOperationV06, UserOperationV07 } from "@alto/types"
import { toViemStateOverrides } from "../../utils/toViemStateOverrides"
import type { AltoConfig } from "../../createConfig"

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