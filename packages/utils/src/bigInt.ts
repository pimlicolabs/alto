/// Resturns the bigger of two BigInts.
export const minBigInt = (a: bigint, b: bigint) => {
    return a < b ? a : b
}

/// Returns the smaller of two BigInts.
export const maxBigInt = (a: bigint, b: bigint) => {
    return a > b ? a : b
}
