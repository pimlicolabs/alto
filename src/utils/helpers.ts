import { type Address, getAddress } from "viem"

/// Ensure proper equality by converting both addresses into their checksum type
export const areAddressesEqual = (a: Address, b: Address) => {
    return getAddress(a) === getAddress(b)
}
