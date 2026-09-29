import { beforeEach, describe, expect, it } from "vitest"
import { InclusionStallDetector } from "../../../../src/executor/inclusionStallDetector"

const BLOCK_TIME_MS = 1_000

describe("InclusionStallDetector", () => {
    let detector: InclusionStallDetector

    // Feed `count` consecutive dry blocks starting at `fromBlock`, one second apart.
    const feedDryBlocks = ({
        fromBlock,
        count,
        startTime = 0,
        pendingCount = 3
    }: {
        fromBlock: number
        count: number
        startTime?: number
        pendingCount?: number
    }) =>
        Array.from({ length: count }, (_, i) =>
            detector.update({
                blockNumber: BigInt(fromBlock + i),
                now: startTime + i * BLOCK_TIME_MS,
                pendingCount,
                landedCount: 0
            })
        )

    beforeEach(() => {
        detector = new InclusionStallDetector({
            minBlocks: 5,
            minDurationMs: 3_000
        })
    })

    it("enters a stall after N dry blocks once T ms have passed", () => {
        const updates = feedDryBlocks({ fromBlock: 100, count: 5 })

        expect(updates.slice(0, 4).every(({ transition }) => !transition)).toBe(
            true
        )
        expect(updates[4]).toEqual({
            transition: "entered",
            blocksWithoutInclusion: 5,
            stalledForMs: 4_000
        })
        expect(detector.isStalled()).toBe(true)
    })

    it("reports entered only once while the stall lasts", () => {
        const updates = feedDryBlocks({ fromBlock: 100, count: 10 })

        expect(
            updates.filter(({ transition }) => transition === "entered")
        ).toHaveLength(1)
        expect(detector.isStalled()).toBe(true)
    })

    it("does not stall on block count alone before the min duration", () => {
        // 10 blocks within 900ms: block threshold met, duration not.
        for (let i = 0; i < 10; i++) {
            detector.update({
                blockNumber: BigInt(100 + i),
                now: i * 100,
                pendingCount: 1,
                landedCount: 0
            })
        }
        expect(detector.isStalled()).toBe(false)

        const { transition } = detector.update({
            blockNumber: 110n,
            now: 3_000,
            pendingCount: 1,
            landedCount: 0
        })
        expect(transition).toBe("entered")
    })

    it("does not stall on duration alone before N blocks", () => {
        // Head barely moves: 4 blocks over a minute.
        for (let i = 0; i < 4; i++) {
            detector.update({
                blockNumber: BigInt(100 + i),
                now: i * 20_000,
                pendingCount: 1,
                landedCount: 0
            })
        }
        expect(detector.isStalled()).toBe(false)
    })

    it("ignores repeated passes for the same block number", () => {
        for (let i = 0; i < 10; i++) {
            detector.update({
                blockNumber: 100n,
                now: i * BLOCK_TIME_MS,
                pendingCount: 1,
                landedCount: 0
            })
        }
        expect(detector.isStalled()).toBe(false)
    })

    it("counts every pass when no block number is given", () => {
        for (let i = 0; i < 5; i++) {
            detector.update({
                blockNumber: undefined,
                now: i * BLOCK_TIME_MS,
                pendingCount: 1,
                landedCount: 0
            })
        }
        expect(detector.isStalled()).toBe(true)
    })

    it("exits the stall on the first inclusion", () => {
        feedDryBlocks({ fromBlock: 100, count: 6 })
        expect(detector.isStalled()).toBe(true)

        const update = detector.update({
            blockNumber: 106n,
            now: 6_000,
            pendingCount: 3,
            landedCount: 1
        })

        expect(update).toEqual({
            transition: "exited",
            blocksWithoutInclusion: 6,
            stalledForMs: 6_000
        })
        expect(detector.isStalled()).toBe(false)
    })

    it("restarts the streak after an inclusion", () => {
        feedDryBlocks({ fromBlock: 100, count: 4 })
        detector.update({
            blockNumber: 104n,
            now: 4_000,
            pendingCount: 3,
            landedCount: 1
        })

        const updates = feedDryBlocks({
            fromBlock: 105,
            count: 4,
            startTime: 5_000
        })
        expect(updates.every(({ transition }) => !transition)).toBe(true)
        expect(detector.isStalled()).toBe(false)
    })

    it("exits the stall when no bundles are pending", () => {
        feedDryBlocks({ fromBlock: 100, count: 6 })
        expect(detector.isStalled()).toBe(true)

        const { transition } = detector.update({
            blockNumber: 106n,
            now: 6_000,
            pendingCount: 0,
            landedCount: 0
        })

        expect(transition).toBe("exited")
        expect(detector.isStalled()).toBe(false)
    })

    it("never stalls when no bundles are pending", () => {
        const updates = feedDryBlocks({
            fromBlock: 100,
            count: 50,
            pendingCount: 0
        })

        expect(updates.every(({ transition }) => !transition)).toBe(true)
        expect(detector.isStalled()).toBe(false)
    })

    it("never stalls when disabled with minBlocks 0", () => {
        detector = new InclusionStallDetector({
            minBlocks: 0,
            minDurationMs: 0
        })

        const updates = feedDryBlocks({ fromBlock: 100, count: 50 })

        expect(updates.every(({ transition }) => !transition)).toBe(true)
        expect(detector.isStalled()).toBe(false)
    })
})
