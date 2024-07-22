import {
    type Address,
    getAddress,
    BaseError,
    type RawContractError
} from "viem"

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
