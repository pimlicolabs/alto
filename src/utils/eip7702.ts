import { StateOverride, concat } from "viem"
import { UserOperation } from "../types/schemas"

export const getEip7702DelegationOverrides = (userOps: UserOperation[]) => {
    let stateOverride: StateOverride = []

    for (const userOp of userOps) {
        if (userOp.eip7702Auth) {
            const delegate =
                "address" in userOp.eip7702Auth
                    ? userOp.eip7702Auth.address
                    : userOp.eip7702Auth.contractAddress

            stateOverride.push({
                address: userOp.sender,
                code: concat(["0xef0100", delegate])
            })
        }
    }

    return stateOverride
}
