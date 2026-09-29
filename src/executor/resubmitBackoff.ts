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

// A pending bundle stops being replaced once it has been resubmitted
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
