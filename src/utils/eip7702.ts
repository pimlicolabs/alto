import { type Address, type StateOverride, concat } from "viem"
import type { UserOperation } from "../types/schemas"

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
