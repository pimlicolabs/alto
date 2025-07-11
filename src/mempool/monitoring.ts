import type { HexData32, UserOperationStatus } from "@alto/types"
import { Redis } from "ioredis"
import type { AltoConfig } from "../createConfig"
import { userOperationStatusSchema } from "../types/schemas"

interface UserOperationStatusStore {
    set(userOpHash: HexData32, status: UserOperationStatus): Promise<void>
    get(userOpHash: HexData32): Promise<UserOperationStatus | undefined>
    delete(userOpHash: HexData32): Promise<void>
}

class InMemoryUserOperationStatusStore implements UserOperationStatusStore {
    private store: Record<HexData32, UserOperationStatus> = {}

    set(userOpHash: HexData32, status: UserOperationStatus) {
        this.store[userOpHash] = status
        return Promise.resolve()
    }

    get(userOpHash: HexData32) {
        return Promise.resolve(this.store[userOpHash])
    }

    delete(userOpHash: HexData32) {
        delete this.store[userOpHash]
        return Promise.resolve()
    }
}

class RedisUserOperationStatusStore implements UserOperationStatusStore {
    private redis: Redis
    private keyPrefix: string

    constructor(redisUrl: string, chainId: number) {
        this.redis = new Redis(redisUrl)
        this.keyPrefix = `${chainId}:userop_status`
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
        userOpHash: HexData32,
        status: UserOperationStatus
    ): Promise<void> {
        await this.redis.set(this.getKey(userOpHash), this.serialize(status))
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
}

export class Monitor {
    private statusStore: UserOperationStatusStore
    private userOpTimeouts: Record<HexData32, NodeJS.Timeout>
    private timeout: number

    constructor({
        config,
        timeout = 60 * 60 * 1000
    }: { config: AltoConfig; timeout?: number }) {
        this.timeout = timeout
        this.userOpTimeouts = {}

        if (config?.redisMempoolUrl) {
            this.statusStore = new RedisUserOperationStatusStore(
                config.redisMempoolUrl,
                config.chainId
            )
        } else {
            this.statusStore = new InMemoryUserOperationStatusStore()
        }
    }

    public async setUserOpStatus(
        userOpHash: HexData32,
        status: UserOperationStatus
    ): Promise<void> {
        // Clear existing timer if it exists
        if (this.userOpTimeouts[userOpHash]) {
            clearTimeout(this.userOpTimeouts[userOpHash])
        }

        // Set the user operation status
        await this.statusStore.set(userOpHash, status)

        // Set a new timer and store its identifier
        this.userOpTimeouts[userOpHash] = setTimeout(async () => {
            await this.statusStore.delete(userOpHash)
            delete this.userOpTimeouts[userOpHash]
        }, this.timeout) as NodeJS.Timeout
    }

    public async getUserOpStatus(
        userOpHash: HexData32
    ): Promise<UserOperationStatus> {
        const status = await this.statusStore.get(userOpHash)
        if (status === undefined) {
            return {
                status: "not_found",
                transactionHash: null
            }
        }
        return status
    }
}
