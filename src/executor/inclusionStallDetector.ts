export type InclusionStallUpdate = {
    transition: "entered" | "exited" | undefined
    // Streak length at the time of this update, before any reset.
    blocksWithoutInclusion: number
    stalledForMs: number
}

// Detects a chain-level inclusion stall: blocks keep arriving while bundles are
// pending, but none of them land. It only consumes data handleBlock already
// has (block number, pending count, landed count), so it adds no RPC calls.
// A lagging read RPC (receipts always missing) looks the same and trips it too.
export class InclusionStallDetector {
    private readonly minBlocks: number
    private readonly minDurationMs: number

    private stalled = false
    // Consecutive handled blocks with pending bundles and nothing landing.
    private blocksWithoutInclusion = 0
    private streakStartedAt: number | undefined
    private lastBlockNumber: bigint | undefined

    constructor({
        minBlocks,
        minDurationMs
    }: {
        // 0 disables the detector.
        minBlocks: number
        minDurationMs: number
    }) {
        this.minBlocks = minBlocks
        this.minDurationMs = minDurationMs
    }

    isStalled(): boolean {
        return this.stalled
    }

    // Feed one handleBlock pass. blockNumber is undefined when blocks are
    // polled at a fixed interval (flashblocks), then every pass counts.
    update({
        blockNumber,
        now,
        pendingCount,
        landedCount
    }: {
        blockNumber: bigint | undefined
        now: number
        pendingCount: number
        landedCount: number
    }): InclusionStallUpdate {
        if (this.minBlocks <= 0) {
            return this.snapshot({ transition: undefined, now })
        }

        // Nothing pending or something landed, the chain is including us.
        if (pendingCount === 0 || landedCount > 0) {
            const wasStalled = this.stalled
            const result = this.snapshot({
                transition: wasStalled ? "exited" : undefined,
                now
            })
            this.reset()
            return result
        }

        // Ignore repeated passes for the same block.
        const isNewBlock =
            blockNumber === undefined || blockNumber !== this.lastBlockNumber
        this.lastBlockNumber = blockNumber

        if (!isNewBlock) {
            return this.snapshot({ transition: undefined, now })
        }

        if (this.streakStartedAt === undefined) {
            this.streakStartedAt = now
        }
        this.blocksWithoutInclusion++

        const shouldStall =
            this.blocksWithoutInclusion >= this.minBlocks &&
            now - this.streakStartedAt >= this.minDurationMs

        const entered = shouldStall && !this.stalled
        if (entered) {
            this.stalled = true
        }

        return this.snapshot({
            transition: entered ? "entered" : undefined,
            now
        })
    }

    private snapshot({
        transition,
        now
    }: {
        transition: InclusionStallUpdate["transition"]
        now: number
    }): InclusionStallUpdate {
        return {
            transition,
            blocksWithoutInclusion: this.blocksWithoutInclusion,
            stalledForMs:
                this.streakStartedAt === undefined
                    ? 0
                    : now - this.streakStartedAt
        }
    }

    private reset(): void {
        this.stalled = false
        this.blocksWithoutInclusion = 0
        this.streakStartedAt = undefined
        this.lastBlockNumber = undefined
    }
}
