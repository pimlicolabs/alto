/// Returns the smaller of two BigInts.
export const minBigInt = (a: bigint, b: bigint) => {
    return a < b ? a : b
}

/// Returns the larger of two BigInts.
export const maxBigInt = (a: bigint, b: bigint) => {
    return a > b ? a : b
}

/// Scale a BigInt by a certain percentage.
export const scaleBigIntByPercent = (
    value: bigint,
    percent: bigint
): bigint => {
    return (value * percent) / 100n
}

/// Unscale a BigInt by a certain percentage (inverse of scaleBigIntByPercent).
export const unscaleBigIntByPercent = (
    value: bigint,
    percent: bigint
): bigint => {
    return (value * 100n) / percent
}

export const roundUpBigInt = ({
    value,
    multiple
}: { value: bigint; multiple: bigint }): bigint => {
    const remainder = value % multiple
    return remainder === 0n ? value : value + (multiple - remainder)
}

/// Returns a random BigInt between lower and upper bounds (inclusive).
export const randomBigInt = ({
    lower = 0n,
    upper
}: { lower?: bigint; upper: bigint }): bigint => {
    if (lower > upper) {
        throw new Error("Lower bound must be less than or equal to upper bound")
    }

    const range = upper - lower + 1n
    const random = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))

    return lower + (random % range)
}
