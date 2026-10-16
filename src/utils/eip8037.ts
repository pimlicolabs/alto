// EIP-8037: tx gas above this goes into the state gas reservoir. State gas
// paid from the reservoir is invisible to gasleft(), so the EntryPoint's gas
// accounting misses it. Keeping every simulation and bundle at or below this
// limit means the reservoir is always empty.
export const EIP8037_TX_MAX_GAS_LIMIT = 16_777_216n

export const getSimulationGasLimit = ({
    supportsEip8037,
    fixedGasLimitForEstimation
}: {
    supportsEip8037: boolean
    fixedGasLimitForEstimation?: bigint
}): bigint | undefined => {
    if (!supportsEip8037) {
        return fixedGasLimitForEstimation
    }

    // Never omit gas: nodes default eth_call gas to 50-100M
    if (
        fixedGasLimitForEstimation === undefined ||
        fixedGasLimitForEstimation > EIP8037_TX_MAX_GAS_LIMIT
    ) {
        return EIP8037_TX_MAX_GAS_LIMIT
    }

    return fixedGasLimitForEstimation
}
