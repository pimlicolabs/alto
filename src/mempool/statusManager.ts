import type { HexData32, UserOperationStatus } from "@alto/types"
import { Redis } from "ioredis"
import type { AltoConfig } from "../createConfig"
import { userOperationStatusSchema } from "../types/schemas"

interface UserOperationStatusStore {
    set(userOpHash: HexData32[], status: UserOperationStatus): Promise<void>
    get(userOpHash: HexData32): Promise<UserOperationStatus | undefined>
    delete(userOpHash: HexData32): Promise<void>
    dumpAll(): Array<{ userOpHash: HexData32; status: UserOperationStatus }>
    restore(
        entries: Array<{ userOpHash: HexData32; status: UserOperationStatus }>
    ): void
}

class MemoryUserOperationStatusStore implements UserOperationStatusStore {
    private readonly ttlMs: number
    private readonly store: Record<
        HexData32,
        { status: UserOperationStatus; timestamp: number }
    > = {}

    constructor(ttlMs: number) {
        this.ttlMs = ttlMs
    }

    private prune() {
        const now = Date.now()
        for (const userOpHash of Object.keys(this.store) as HexData32[]) {
            if (now - this.store[userOpHash].timestamp > this.ttlMs) {
                delete this.store[userOpHash]
            }
        }
    }

    async set(userOpHashes: HexData32[], status: UserOperationStatus) {
        this.prune()
        const timestamp = Date.now()
        for (const userOpHash of userOpHashes) {
            this.store[userOpHash] = { status, timestamp }
        }
    }

    async get(userOpHash: HexData32) {
        this.prune()
        const entry = this.store[userOpHash]
        return entry?.status
    }

    async delete(userOpHash: HexData32) {
        delete this.store[userOpHash]
    }

    dumpAll() {
        this.prune()
        return Object.entries(this.store).map(([userOpHash, { status }]) => ({
            userOpHash: userOpHash as HexData32,
            status
        }))
    }

    restore(
        entries: Array<{ userOpHash: HexData32; status: UserOperationStatus }>
    ) {
        const timestamp = Date.now()
        for (const { userOpHash, status } of entries) {
            this.store[userOpHash] = { status, timestamp }
        }
    }
}

class RedisUserOperationStatusStore implements UserOperationStatusStore {
    private readonly redis: Redis
    private readonly keyPrefix: string
    private readonly ttlSeconds: number

    constructor({
        config,
        redisEndpoint,
        ttlSeconds = 3600 // 1 hour ttl by default
    }: {
        config: AltoConfig
        ttlSeconds?: number
        redisEndpoint: string
    }) {
        this.redis = new Redis(redisEndpoint)
        this.keyPrefix = `${config.redisKeyPrefix}:${config.chainId}:userop-status`
        this.ttlSeconds = ttlSeconds
    }

    private getKey(userOpHash: HexData32): string {
        return `${this.keyPrefix}:${userOpHash}`
    }

    private serialize(status: UserOperationStatus): string {
        try {
            return JSON.stringify(status)
        } catch (error) {
            throw new Error(
                `Failed to serialize UserOperationStatus: ${
                    error instanceof Error ? error.message : "Unknown error"
                }`
            )
        }
    }

    private deserialize(data: string): UserOperationStatus {
        try {
            const parsed = JSON.parse(data)
            const result = userOperationStatusSchema.safeParse(parsed)

            if (!result.success) {
                throw new Error(
                    `Invalid UserOperationStatus format: ${result.error.message}`
                )
            }

            return result.data
        } catch (error) {
            throw new Error(
                `Failed to deserialize UserOperationStatus: ${
                    error instanceof Error ? error.message : "Unknown error"
                }`
            )
        }
    }

    async set(
        userOpHashes: HexData32[],
        status: UserOperationStatus
    ): Promise<void> {
        if (userOpHashes.length === 0) return

        const pipeline = this.redis.pipeline()

        for (const userOpHash of userOpHashes) {
            const key = this.getKey(userOpHash)
            const serialized = this.serialize(status)
            pipeline.set(key, serialized, "EX", this.ttlSeconds)
        }

        await pipeline.exec()
    }

    async get(userOpHash: HexData32): Promise<UserOperationStatus | undefined> {
        const data = await this.redis.get(this.getKey(userOpHash))
        if (!data) {
            return undefined
        }
        return this.deserialize(data)
    }

    async delete(userOpHash: HexData32): Promise<void> {
        await this.redis.del(this.getKey(userOpHash))
    }

    dumpAll() {
        // Redis doesn't need dumping - TTL handles persistence
        return []
    }

    restore(
        _entries: Array<{ userOpHash: HexData32; status: UserOperationStatus }>
    ) {
        // Redis doesn't need restoration - data persists with TTL
    }
}

export class StatusManager {
    private readonly statusStore: UserOperationStatusStore

    constructor({
        config,
        timeout = 60 * 60 * 1000
    }: { config: AltoConfig; timeout?: number }) {
        if (config.enableHorizontalScaling && config.redisEndpoint) {
            this.statusStore = new RedisUserOperationStatusStore({
                config,
                redisEndpoint: config.redisEndpoint,
                ttlSeconds: Math.floor(timeout / 1000)
            })
        } else {
            this.statusStore = new MemoryUserOperationStatusStore(timeout)
        }
    }

    public async set(
        userOpHashes: HexData32[],
        status: UserOperationStatus
    ): Promise<void> {
        await this.statusStore.set(userOpHashes, status)
    }

    public async get(userOpHash: HexData32): Promise<UserOperationStatus> {
        const status = await this.statusStore.get(userOpHash)
        if (status === undefined) {
            return {
                status: "not_found",
                transactionHash: null
            }
        }
        return status
    }

    public dumpAll(): Array<{
        userOpHash: HexData32
        status: UserOperationStatus
    }> {
        return this.statusStore.dumpAll()
    }

    public restore(
        entries: Array<{ userOpHash: HexData32; status: UserOperationStatus }>
    ): void {
        this.statusStore.restore(entries)
    }
}
