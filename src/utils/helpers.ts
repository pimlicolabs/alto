import type { StateOverrides, UserOperation } from "@alto/types"
import { BaseError, type RawContractError, getAddress, concat } from "viem"
import type {
    SignedAuthorization,
    StateOverride as ViemStateOverride,
    Hex
} from "viem"

/// Convert an object to JSON string, handling bigint values
export const jsonStringifyWithBigint = (obj: unknown): string => {
    return JSON.stringify(obj, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
    )
}

/// Ensure proper equality by converting both addresses into their checksum type
export const areAddressesEqual = (a: string, b: string) => {
    try {
        return getAddress(a) === getAddress(b)
    } catch {
        return false
    }
}

export function getRevertErrorData(err: unknown) {
    if (!(err instanceof BaseError)) {
        return undefined
    }
    const error = err.walk() as RawContractError
    return typeof error?.data === "object" ? error.data?.data : error.data
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
    userOperations,
    stateOverrides
}: {
    userOperations: UserOperation[]
    stateOverrides?: StateOverrides
}): ViemStateOverride {
    const result: ViemStateOverride = []

    // First, convert existing state overrides to Viem format
    if (stateOverrides) {
        for (const [address, override] of Object.entries(stateOverrides)) {
            // Skip if override is undefined
            if (!override) continue

            try {
                const validatedAddress = getAddress(address)
                const entry: ViemStateOverride[number] = {
                    address: validatedAddress,
                    balance:
                        override.balance !== undefined
                            ? override.balance
                            : undefined,
                    nonce:
                        override.nonce !== undefined
                            ? Number(override.nonce)
                            : undefined,
                    code: override.code
                }

                // Convert state or stateDiff from record to array format
                if (override.state) {
                    entry.state = Object.entries(override.state).map(
                        ([slot, value]) => ({
                            slot: slot as Hex,
                            value: value as Hex
                        })
                    )
                }

                if (override.stateDiff) {
                    entry.stateDiff = Object.entries(override.stateDiff).map(
                        ([slot, value]) => ({
                            slot: slot as Hex,
                            value: value as Hex
                        })
                    )
                }

                result.push(entry)
            } catch (e) {
                console.warn(`Invalid address in state override: ${address}`)
            }
        }
    }

    // Then add authorization overrides
    for (const op of userOperations) {
        if (op.eip7702Auth) {
            const authOverride = getAuthorizationStateOverride({
                authorization: {
                    address:
                        "address" in op.eip7702Auth
                            ? op.eip7702Auth.address
                            : op.eip7702Auth.contractAddress,
                    chainId: op.eip7702Auth.chainId,
                    nonce: op.eip7702Auth.nonce,
                    r: op.eip7702Auth.r,
                    s: op.eip7702Auth.s,
                    v: op.eip7702Auth.v,
                    yParity: op.eip7702Auth.yParity
                }
            })

            try {
                const validatedAddress = getAddress(op.sender)

                // Check if we already have an override for this address
                const existingIndex = result.findIndex(
                    (o) => o.address === validatedAddress
                )

                if (existingIndex >= 0) {
                    // Merge with existing override
                    result[existingIndex] = {
                        ...result[existingIndex],
                        code: authOverride.code as Hex
                    }
                } else {
                    // Add new override
                    result.push({
                        address: validatedAddress,
                        code: authOverride.code as Hex
                    })
                }
            } catch (e) {
                console.warn(`Invalid sender address: ${op.sender}`)
            }
        }
    }

    return result
}
