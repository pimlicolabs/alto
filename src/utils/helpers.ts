import { StateOverrides } from "@alto/types"
import {
    type Address,
    BaseError,
    type RawContractError,
    getAddress,
    PublicClient
} from "viem"
import {
    SignedAuthorizationList,
    recoverAuthorizationAddress
} from "viem/experimental"

/// Ensure proper equality by converting both addresses into their checksum type
export const areAddressesEqual = (a: Address, b: Address) => {
    return getAddress(a) === getAddress(b)
}

export function getRevertErrorData(err: unknown) {
    // biome-ignore lint/style/useBlockStatements:
    if (!(err instanceof BaseError)) return undefined
    const error = err.walk() as RawContractError
    return typeof error?.data === "object" ? error.data?.data : error.data
}

// biome-ignore lint/style/useNamingConvention:
export function getAAError(errorMsg: string) {
    const uppercase = errorMsg.toUpperCase()
    const match = uppercase.match(/AA\d{2}/)
    return match ? match[0] : undefined
}

// authorizationList is not currently supported in viem's sendTransaction, this is a temporary solution
export async function addAuthorizationStateOverrides({
    publicClient,
    authorizationList,
    stateOverrides
}: {
    publicClient: PublicClient
    authorizationList: SignedAuthorizationList
    stateOverrides?: StateOverrides
}) {
    if (!stateOverrides) stateOverrides = {}

    for (const authorization of authorizationList) {
        const sender = await recoverAuthorizationAddress({ authorization })
        const code = await publicClient.getCode({
            address: authorization.contractAddress
        })
        stateOverrides[sender] = { ...stateOverrides?.[sender], code }
    }

    return stateOverrides
}
