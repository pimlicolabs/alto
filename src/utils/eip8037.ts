// EIP-8037: tx gas above the chain's tx gas cap goes into the state gas
// reservoir. State gas paid from the reservoir is invisible to gasleft(), so
// the EntryPoint's gas accounting misses it. Keeping every simulation at or
// below the cap means the reservoir is always empty.
export const getSimulationGasLimit = ({
    supportsEip8037,
    txMaxGasLimit,
    fixedGasLimitForEstimation
}: {
    supportsEip8037: boolean
    txMaxGasLimit: bigint
    fixedGasLimitForEstimation?: bigint
}): bigint | undefined => {
    if (!supportsEip8037) {
        return fixedGasLimitForEstimation
    }

    // Never omit gas: nodes default eth_call gas to 50-100M
    if (
        fixedGasLimitForEstimation === undefined ||
        fixedGasLimitForEstimation > txMaxGasLimit
    ) {
        return txMaxGasLimit
    }

    return fixedGasLimitForEstimation
}
