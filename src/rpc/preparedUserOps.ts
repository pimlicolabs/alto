import type { Mempool } from "@alto/mempool"
import type { UserOperationBundle } from "@alto/types"
import type { Logger } from "@alto/utils"
import { type Hex, toHex } from "viem"
import type { FilterOpsResult } from "../executor/filterOpsAndEstimateGas"

export type PreparedUserOp = {
    bundle: UserOperationBundle
    filterOpsResult: FilterOpsResult
}

type Entry = PreparedUserOp & { timer: ReturnType<typeof setTimeout> }

// UserOps prepared with pimlico_prepareUserOperation, kept in memory until
// they are sent, cancelled or expire. A prepared userOp stays marked as
// processing, so the mempool doesn't bundle it meanwhile.
export class PreparedUserOps {
    private readonly entries = new Map<Hex, Entry>()
    // Prepared or being prepared.
    private readonly userOpHashes = new Set<Hex>()
    private readonly mempool: Mempool
    private readonly logger: Logger
    private readonly ttlMs: number

    constructor({
        mempool,
        logger,
        ttlMs
    }: {
        mempool: Mempool
        logger: Logger
        ttlMs: number
    }) {
        this.mempool = mempool
        this.logger = logger
        this.ttlMs = ttlMs
    }

    // Returns false if the userOp is already prepared or being prepared.
    reserve(userOpHash: Hex): boolean {
        if (this.userOpHashes.has(userOpHash)) {
            return false
        }
        this.userOpHashes.add(userOpHash)
        return true
    }

    // Ends a reservation whose prepare failed.
    unreserve(userOpHash: Hex) {
        this.userOpHashes.delete(userOpHash)
    }

    // Stores a reserved userOp and returns its id.
    add(prepared: PreparedUserOp): Hex {
        const id = toHex(crypto.getRandomValues(new Uint8Array(32)))
        const timer = setTimeout(() => {
            this.release(id).catch((err: unknown) => {
                this.logger.error(
                    { err, id },
                    "failed to release expired prepared userOperation"
                )
            })
        }, this.ttlMs)
        timer.unref()
        this.entries.set(id, { ...prepared, timer })
        return id
    }

    // Removes the prepared userOp and returns it, still marked as processing.
    take(id: Hex): PreparedUserOp | undefined {
        const entry = this.entries.get(id)
        if (!entry) {
            return undefined
        }
        clearTimeout(entry.timer)
        this.entries.delete(id)
        this.userOpHashes.delete(entry.bundle.userOps[0].userOpHash)
        const { timer: _, ...prepared } = entry
        return prepared
    }

    // Removes the prepared userOp and its processing mark. Returns false if
    // there was none.
    async release(id: Hex): Promise<boolean> {
        const prepared = this.take(id)
        if (!prepared) {
            return false
        }
        const { entryPoint, userOps } = prepared.bundle
        await this.mempool.removeProcessing({ entryPoint, userOps })
        return true
    }
}
