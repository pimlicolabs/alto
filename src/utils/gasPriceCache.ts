import type { GasPriceParameters } from "@alto/types"

interface CacheEntry<T> {
    value: T
    timestamp: number
}

export class GasPriceCache {
    private cache = new Map<string, CacheEntry<GasPriceParameters>>()
    private readonly ttl: number // Time to live in milliseconds

    constructor(ttlSeconds = 5) {
        this.ttl = ttlSeconds * 1000
    }

    /**
     * Get cached gas price if still valid
     */
    get(chainId: number): GasPriceParameters | null {
        const key = `gasPrice-${chainId}`
        const entry = this.cache.get(key)

        if (!entry) {
            return null
        }

        const now = Date.now()
        if (now - entry.timestamp > this.ttl) {
            this.cache.delete(key)
            return null
        }

        return entry.value
    }

    /**
     * Set gas price in cache
     */
    set(chainId: number, gasPrice: GasPriceParameters): void {
        const key = `gasPrice-${chainId}`
        this.cache.set(key, {
            value: gasPrice,
            timestamp: Date.now()
        })
    }

    /**
     * Clear cache for a specific chain or all chains
     */
    clear(chainId?: number): void {
        if (chainId !== undefined) {
            this.cache.delete(`gasPrice-${chainId}`)
        } else {
            this.cache.clear()
        }
    }

    /**
     * Get or fetch gas price with caching
     */
    async getOrFetch(
        chainId: number,
        fetcher: () => Promise<GasPriceParameters>
    ): Promise<GasPriceParameters> {
        const cached = this.get(chainId)
        if (cached) {
            return cached
        }

        const gasPrice = await fetcher()
        this.set(chainId, gasPrice)
        return gasPrice
    }
}
