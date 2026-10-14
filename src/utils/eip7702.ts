import { type Address, type StateOverride, concat } from "viem"
import type { UserOperation } from "../types/schemas"

// EIP-2780 / EIP-8037 authorization costs
export const EIP2780_EXECUTION_PER_AUTH_BASE_COST = 7816n
export const EIP2780_ACCOUNT_WRITE = 9000n
export const EIP8037_NEW_ACCOUNT_STATE_GAS = 183_600n // 120 bytes * CPSB (1530)
export const EIP8037_AUTH_BASE_STATE_GAS = 35_190n // 23 bytes * CPSB (1530)
export const EIP2780_MAX_AUTH_GAS =
    EIP2780_EXECUTION_PER_AUTH_BASE_COST +
    EIP2780_ACCOUNT_WRITE +
    EIP8037_NEW_ACCOUNT_STATE_GAS +
    EIP8037_AUTH_BASE_STATE_GAS

export const getEip7702AuthAddress = (
    eip7702Auth: NonNullable<UserOperation["eip7702Auth"]>
): Address => {
    return "address" in eip7702Auth
        ? eip7702Auth.address
        : eip7702Auth.contractAddress
}

export const getEip7702DelegationOverrides = (
    userOps: UserOperation[]
): StateOverride | undefined => {
    // Use Map to deduplicate by sender address
    const overrideMap = new Map<Address, StateOverride[number]>()

    for (const userOp of userOps) {
        if (userOp.eip7702Auth) {
            const delegate = getEip7702AuthAddress(userOp.eip7702Auth)
            const code = concat(["0xef0100", delegate])

            // Only add if not already present, or update if present
            overrideMap.set(userOp.sender, {
                address: userOp.sender,
                code
            })
        }
    }

    if (overrideMap.size === 0) {
        return undefined
    }

    return Array.from(overrideMap.values())
}
