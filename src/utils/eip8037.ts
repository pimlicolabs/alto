// EIP-8037 state gas for the first write to an empty storage slot
// (64 bytes * CPSB (1530))
export const EIP8037_NEW_SLOT_STATE_GAS = 97_920n

// EIP-7825 cap on a transaction's regular gas. Under EIP-8037, transaction
// gas above it is the state gas reservoir
export const TX_MAX_GAS_LIMIT = 16_777_216n
