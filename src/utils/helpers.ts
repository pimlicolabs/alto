import type { StateOverrides, UserOperation } from "@alto/types"
import { type SignedAuthorization, concat, getAddress } from "viem"
import { getEip7702AuthAddress } from "./eip7702"

/// Convert an object to JSON string, handling bigint values
export const jsonStringifyWithBigint = (obj: unknown): string => {
    return JSON.stringify(obj, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
    )
}

/// Convert an object to JSON string, handling bigint values
export const recoverableJsonStringifyWithBigint = (obj: unknown): string => {
    return JSON.stringify(obj, (_key, value) =>
        typeof value === "bigint"
            ? {
                  type: "bigint",
                  value: value.toString()
              }
            : value
    )
}

export const recoverableJsonParseWithBigint = (str: string): any => {
    return JSON.parse(str, (_key, value) => {
        if (
            value !== null &&
            typeof value === "object" &&
            "type" in value &&
            value.type === "bigint" &&
            "value" in value &&
            typeof value.value === "string"
        ) {
            try {
                return BigInt(value.value)
            } catch {
                return value
            }
        }
        return value
    })
}

/// Ensure proper equality by converting both addresses into their checksum type
export const areAddressesEqual = (a: string, b: string) => {
    try {
        return getAddress(a) === getAddress(b)
    } catch {
        return false
    }
}

export function getAAError(errorMsg: string) {
    const uppercase = errorMsg.toUpperCase()
    const match = uppercase.match(/AA\d{2}/)
    return match ? match[0] : undefined
}

// authorizationList is not currently supported in viem's sendTransaction, this is a temporary solution
function getAuthorizationStateOverride({
    authorization
}: {
    authorization: SignedAuthorization
}) {
    const code = concat(["0xef0100", authorization.address])
    return { code }
}

export function getAuthorizationStateOverrides({
    userOps,
    stateOverrides
}: {
    userOps: UserOperation[]
    stateOverrides?: StateOverrides
}) {
    const overrides: StateOverrides = { ...(stateOverrides ?? {}) }

    for (const op of userOps) {
        if (op.eip7702Auth) {
            overrides[op.sender] = {
                ...(overrides[op.sender] || {}),
                ...getAuthorizationStateOverride({
                    authorization: {
                        address: getEip7702AuthAddress(op.eip7702Auth),
                        chainId: op.eip7702Auth.chainId,
                        nonce: op.eip7702Auth.nonce,
                        r: op.eip7702Auth.r,
                        s: op.eip7702Auth.s,
                        v: op.eip7702Auth.v,
                        yParity: op.eip7702Auth.yParity
                    }
                })
            }
        }
    }

    return overrides
}
