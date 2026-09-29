import { describe, expect, it } from "vitest"
import {
    getEffectiveStuckTimeout,
    getResubmitAction,
    hasReachedMaxResubmits
} from "../../../../src/executor/resubmitBackoff"

describe("getEffectiveStuckTimeout", () => {
    const base = {
        resubmitStuckTimeout: 10_000,
        backoffFactor: 2,
        maxStuckTimeout: 120_000
    }

    it("keeps the first attempt at the base stuck timeout", () => {
        expect(
            getEffectiveStuckTimeout({ ...base, submissionAttempts: 0 })
        ).toBe(10_000)
    })

    it("widens the timeout by backoffFactor per attempt", () => {
        expect(
            getEffectiveStuckTimeout({ ...base, submissionAttempts: 1 })
        ).toBe(20_000)
        expect(
            getEffectiveStuckTimeout({ ...base, submissionAttempts: 2 })
        ).toBe(40_000)
        expect(
            getEffectiveStuckTimeout({ ...base, submissionAttempts: 3 })
        ).toBe(80_000)
    })

    it("caps the timeout at maxStuckTimeout", () => {
        // 10_000 * 2 ** 4 = 160_000, above the 120_000 cap.
        expect(
            getEffectiveStuckTimeout({ ...base, submissionAttempts: 4 })
        ).toBe(120_000)
        expect(
            getEffectiveStuckTimeout({ ...base, submissionAttempts: 50 })
        ).toBe(120_000)
    })

    it("is monotonically non-decreasing across attempts", () => {
        let previous = 0
        for (let attempts = 0; attempts <= 10; attempts++) {
            const timeout = getEffectiveStuckTimeout({
                ...base,
                submissionAttempts: attempts
            })
            expect(timeout).toBeGreaterThanOrEqual(previous)
            previous = timeout
        }
    })

    it("disables backoff when factor is 1", () => {
        for (const submissionAttempts of [0, 1, 5, 20]) {
            expect(
                getEffectiveStuckTimeout({
                    ...base,
                    backoffFactor: 1,
                    submissionAttempts
                })
            ).toBe(10_000)
        }
    })
})

describe("hasReachedMaxResubmits", () => {
    it("never limits when maxResubmits is unset", () => {
        expect(
            hasReachedMaxResubmits({
                submissionAttempts: 1000,
                maxResubmits: undefined
            })
        ).toBe(false)
    })

    it("limits once submissionAttempts reaches maxResubmits", () => {
        expect(
            hasReachedMaxResubmits({ submissionAttempts: 2, maxResubmits: 3 })
        ).toBe(false)
        expect(
            hasReachedMaxResubmits({ submissionAttempts: 3, maxResubmits: 3 })
        ).toBe(true)
        expect(
            hasReachedMaxResubmits({ submissionAttempts: 4, maxResubmits: 3 })
        ).toBe(true)
    })
})

describe("getResubmitAction", () => {
    const base = { submissionAttempts: 0, maxResubmits: 3 }

    it("does nothing when gas is fine and the bundle isn't stuck", () => {
        expect(
            getResubmitAction({
                ...base,
                isGasPriceTooLow: false,
                isStuck: false
            })
        ).toBe("none")
    })

    it("replaces a stuck bundle below the cap", () => {
        expect(
            getResubmitAction({
                ...base,
                submissionAttempts: 2,
                isGasPriceTooLow: false,
                isStuck: true
            })
        ).toBe("replace_stuck")
    })

    it("drops a stuck bundle once it reaches the cap", () => {
        expect(
            getResubmitAction({
                ...base,
                submissionAttempts: 3,
                isGasPriceTooLow: false,
                isStuck: true
            })
        ).toBe("drop")
    })

    it("exempts gas-price bumps from the cap", () => {
        for (const isStuck of [false, true]) {
            expect(
                getResubmitAction({
                    ...base,
                    submissionAttempts: 10,
                    isGasPriceTooLow: true,
                    isStuck
                })
            ).toBe("replace_gas_price")
        }
    })

    it("never drops when maxResubmits is unset", () => {
        expect(
            getResubmitAction({
                submissionAttempts: 1000,
                maxResubmits: undefined,
                isGasPriceTooLow: false,
                isStuck: true
            })
        ).toBe("replace_stuck")
    })
})
