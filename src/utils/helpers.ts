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
