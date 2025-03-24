import type { StateOverrides, UserOperation } from "@alto/types"
import {
    BaseError,
    type RawContractError,
    getAddress,
    type PublicClient
} from "viem"
import type { SignedAuthorization } from "viem/experimental"

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
async function getAuthorizationStateOverride({
    publicClient,
    authorization
}: {
    publicClient: PublicClient
    authorization: SignedAuthorization
}) {
    const code = await publicClient.getCode({
        address: authorization.contractAddress
    })
    return { code }
}

export async function getAuthorizationStateOverrides({
    userOperations,
    publicClient,
    stateOverrides
}: {
    userOperations: UserOperation[]
    publicClient: PublicClient
    stateOverrides?: StateOverrides
}) {
    const overrides: StateOverrides = { ...(stateOverrides ?? {}) }

    await Promise.all([
        ...userOperations.map(async (op) => {
            if (op.eip7702Auth) {
                overrides[op.sender] = {
                    ...(overrides[op.sender] || {}),
                    ...(await getAuthorizationStateOverride({
                        authorization: {
                            contractAddress:
                                "address" in op.eip7702Auth
                                    ? op.eip7702Auth.address
                                    : op.eip7702Auth.contractAddress,
                            chainId: op.eip7702Auth.chainId,
                            nonce: op.eip7702Auth.nonce,
                            r: op.eip7702Auth.r,
                            s: op.eip7702Auth.s,
                            v: op.eip7702Auth.v,
                            yParity: op.eip7702Auth.yParity
                        },
                        publicClient
                    }))
                }
            }
        })
    ])

    return overrides
}
