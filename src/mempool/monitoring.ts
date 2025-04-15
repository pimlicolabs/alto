import type { HexData32, UserOperationStatus } from "@alto/types"
import { AltoConfig } from "../createConfig"
import { Redis } from "ioredis"
import { userOperationStatusSchema } from "../types/schemas"

interface UserOperationStatusStore {
    set(userOpHash: HexData32, status: UserOperationStatus): Promise<void>
    get(userOpHash: HexData32): Promise<UserOperationStatus | undefined>
    delete(userOpHash: HexData32): Promise<void>
}

class InMemoryUserOperationStatusStore implements UserOperationStatusStore {
    private store: Record<HexData32, UserOperationStatus> = {}

    async set(
        userOpHash: HexData32,
        status: UserOperationStatus
    ): Promise<void> {
        this.store[userOpHash] = status
    }

    async get(userOpHash: HexData32): Promise<UserOperationStatus | undefined> {
        return this.store[userOpHash]
    }

    async delete(userOpHash: HexData32): Promise<void> {
        delete this.store[userOpHash]
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
        if (!data) return undefined
        return this.deserialize(data)
    }

    async delete(userOpHash: HexData32): Promise<void> {
        await this.redis.del(this.getKey(userOpHash))
    }
}

export class Monitor {
    private statusStore: UserOperationStatusStore
    private userOperationTimeouts: Record<HexData32, NodeJS.Timeout>
    private timeout: number

    constructor({
        config,
        timeout = 60 * 60 * 1000
    }: { config: AltoConfig; timeout?: number }) {
        this.timeout = timeout
        this.userOperationTimeouts = {}

        if (config?.redisMempoolUrl) {
            this.statusStore = new RedisUserOperationStatusStore(
                config.redisMempoolUrl,
                config.chainId
            )
        } else {
            this.statusStore = new InMemoryUserOperationStatusStore()
        }
    }

    public async setUserOperationStatus(
        userOperation: HexData32,
        status: UserOperationStatus
    ): Promise<void> {
        // Clear existing timer if it exists
        if (this.userOperationTimeouts[userOperation]) {
            clearTimeout(this.userOperationTimeouts[userOperation])
        }

        // Set the user operation status
        await this.statusStore.set(userOperation, status)

        // Set a new timer and store its identifier
        this.userOperationTimeouts[userOperation] = setTimeout(async () => {
            await this.statusStore.delete(userOperation)
            delete this.userOperationTimeouts[userOperation]
        }, this.timeout) as NodeJS.Timeout
    }

    public async getUserOperationStatus(
        userOperation: HexData32
    ): Promise<UserOperationStatus> {
        const status = await this.statusStore.get(userOperation)
        if (status === undefined) {
            return {
                status: "not_found",
                transactionHash: null
            }
        }
        return status
    }
}
