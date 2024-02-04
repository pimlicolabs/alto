/// Resturns the bigger value of two BigInt values.
export const minBigInt = (a: bigint, b: bigint) => {
  return (a < b) ? a : b;
}

/// Returns the smaller value of two BigInt values.
export const maxBigInt = (a: bigint, b: bigint) => {
  return (a > b) ? a : b;
}
