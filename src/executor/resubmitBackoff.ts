// Pure helpers that throttle how aggressively alto replaces (gas-bumps) a
// pending bundle that hasn't been mined yet. Kept dependency-free so the
// throttling math can be unit-tested in isolation from ExecutorManager.

// Widen the "stuck" resubmit interval with each replacement attempt so a chain
// stall doesn't trigger a fixed-cadence replacement storm across every executor
// wallet. submissionAttempts is the number of times the bundle has already been
// replaced (0 on first submission), so the first replacement still fires at
// ~resubmitStuckTimeout and each subsequent attempt waits backoffFactor times
// longer, capped at maxStuckTimeout.
export const getEffectiveStuckTimeout = ({
    submissionAttempts,
    resubmitStuckTimeout,
    backoffFactor,
    maxStuckTimeout
}: {
    submissionAttempts: number
    resubmitStuckTimeout: number
    backoffFactor: number
    maxStuckTimeout: number
}): number => {
    const backoff = backoffFactor ** submissionAttempts
    return Math.min(resubmitStuckTimeout * backoff, maxStuckTimeout)
}

// A stuck bundle stops being replaced once it has been resubmitted
// maxResubmits times. maxResubmits is optional: when unset there is no limit.
export const hasReachedMaxResubmits = ({
    submissionAttempts,
    maxResubmits
}: {
    submissionAttempts: number
    maxResubmits: number | undefined
}): boolean => {
    return maxResubmits !== undefined && submissionAttempts >= maxResubmits
}

export type ResubmitAction =
    | "replace_gas_price"
    | "replace_stuck"
    | "drop"
    | "none"

// Decide what to do with a pending bundle that hasn't been mined yet.
// Gas-price bumps take priority and are exempt from max-resubmits: a bundle
// priced below the network is always replaced, regardless of the cap. Only
// stuck replacements are capped. submissionAttempts counts every replacement
// (gas-price bumps included), so the stuck cap and backoff are driven by the
// total number of attempts.
export const getResubmitAction = ({
    isGasPriceTooLow,
    isStuck,
    submissionAttempts,
    maxResubmits
}: {
    isGasPriceTooLow: boolean
    isStuck: boolean
    submissionAttempts: number
    maxResubmits: number | undefined
}): ResubmitAction => {
    if (isGasPriceTooLow) {
        return "replace_gas_price"
    }

    if (!isStuck) {
        return "none"
    }

    if (hasReachedMaxResubmits({ submissionAttempts, maxResubmits })) {
        return "drop"
    }

    return "replace_stuck"
}
