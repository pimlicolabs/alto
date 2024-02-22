import { type Address, getAddress } from "viem"

/// Resturns the bigger of two BigInts.
export const minBigInt = (a: bigint, b: bigint) => {
    return a < b ? a : b
}

/// Returns the smaller of two BigInts.
export const maxBigInt = (a: bigint, b: bigint) => {
    return a > b ? a : b
}

/// Ensure proper equality by converting both addresses into their checksum type
export const areAddressesEqual = (a: Address, b: Address) => {
    return getAddress(a) === getAddress(b)
}
