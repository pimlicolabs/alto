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
    const stateOverride: StateOverride = []

    for (const userOp of userOps) {
        if (userOp.eip7702Auth) {
            const delegate = getEip7702AuthAddress(userOp.eip7702Auth)

            stateOverride.push({
                address: userOp.sender,
                code: concat(["0xef0100", delegate])
            })
        }
    }

    if (stateOverride.length === 0) {
        return undefined
    }

    return stateOverride
}
