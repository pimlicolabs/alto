import type { UserOperationReceipt } from "@alto/types"
import type { Hex } from "viem"
import type { ReceiptCache } from "./index"

interface CachedReceipt {
    receipt: UserOperationReceipt
    timestamp: number
}

export const createMemoryReceiptCache = (ttl: number): ReceiptCache => {
    const cache = new Map<Hex, CachedReceipt>()

    const pruneExpired = (): void => {
        const now = Date.now()
        const expiredEntries = Array.from(cache.entries()).filter(
            ([_, cached]) => now - cached.timestamp > ttl
        )

        for (const [userOpHash] of expiredEntries) {
            cache.delete(userOpHash)
        }
    }

    return {
        get: async (
            userOpHash: Hex
        ): Promise<UserOperationReceipt | undefined> => {
            const cached = cache.get(userOpHash)
            if (!cached) {
                return undefined
            }

            return cached.receipt
        },

        cache: async (receipts: UserOperationReceipt[]): Promise<void> => {
            pruneExpired()
            const timestamp = Date.now()
            for (const receipt of receipts) {
                cache.set(receipt.userOpHash, {
                    receipt,
                    timestamp
                })
            }
        }
    }
}
