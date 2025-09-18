import type { ProcessingStore } from "@alto/store"
import type { UserOpInfo, UserOperation } from "@alto/types"
import { isDeployment } from "@alto/utils"
import { Redis } from "ioredis"
import type { Address, Hex } from "viem"
import type { AltoConfig } from "../../createConfig"

// Extend Redis type with our custom commands.
interface CustomRedis extends Redis {
    startProcessing(
        key1: string,
        key2: string,
        key3: string,
        userOpHash: string,
        senderNonceId: string,
        sender: string,
        isDeployment: string
    ): Promise<number>

    finishProcessing(
        key1: string,
        key2: string,
        key3: string,
        userOpHash: string,
        senderNonceId: string,
        sender: string
    ): Promise<void>

    checkConflict(
        key1: string,
        key2: string,
        senderNonceId: string,
        sender: string
    ): Promise<string | null>
}

export class RedisProcessingStore implements ProcessingStore {
    private redis: CustomRedis

    private processingUserOpsSet: string // set of userOpHashes being processed
    private processingSenderNonceSet: string // set of "sender:nonce" being processed
    private processingDeploymentSet: string // set of senders with deployments being processed

    private encodeSenderNonceId(sender: Address, nonce: bigint): string {
        return `${sender}:${nonce}`
    }

    constructor({
        config,
        entryPoint,
        redisEndpoint
    }: {
        config: AltoConfig
        entryPoint: Address
        redisEndpoint: string
    }) {
        this.redis = new Redis(redisEndpoint) as CustomRedis

        const redisPrefix = `${config.redisKeyPrefix}:${config.chainId}:${entryPoint}:processing`
        this.processingUserOpsSet = `${redisPrefix}:userOps`
        this.processingSenderNonceSet = `${redisPrefix}:senderNonce`
        this.processingDeploymentSet = `${redisPrefix}:deployment`

        // Define custom commands to avoid RTT.
        this.redis.defineCommand("startProcessing", {
            numberOfKeys: 3,
            lua: `
                local processingUserOpsSet = KEYS[1]
                local processingSenderNonceSet = KEYS[2]
                local processingDeploymentSet = KEYS[3]

                local userOpHash = ARGV[1]
                local senderNonceId = ARGV[2]
                local sender = ARGV[3]
                local isDeployment = ARGV[4]

                -- Add userOp to processing set
                redis.call('sadd', processingUserOpsSet, userOpHash)

                -- Add nonce to processing set
                redis.call('sadd', processingSenderNonceSet, senderNonceId)

                -- Add deployment if applicable
                if isDeployment == "true" then
                    redis.call('sadd', processingDeploymentSet, sender)
                end

                return 1
            `
        })

        this.redis.defineCommand("finishProcessing", {
            numberOfKeys: 3,
            lua: `
                local processingUserOpsSet = KEYS[1]
                local processingSenderNonceSet = KEYS[2]
                local processingDeploymentSet = KEYS[3]

                local userOpHash = ARGV[1]
                local senderNonceId = ARGV[2]
                local sender = ARGV[3]

                redis.call('srem', processingUserOpsSet, userOpHash)
                redis.call('srem', processingSenderNonceSet, senderNonceId)
                redis.call('srem', processingDeploymentSet, sender)
            `
        })

        this.redis.defineCommand("checkConflict", {
            numberOfKeys: 2,
            lua: `
                local processingSenderNonceSet = KEYS[1]
                local processingDeploymentSet = KEYS[2]

                local senderNonceId = ARGV[1]
                local sender = ARGV[2]

                -- Check deployment conflict first
                if redis.call('sismember', processingDeploymentSet, sender) == 1 then
                    return "deployment_conflict"
                end

                -- Check nonce conflict
                if redis.call('sismember', processingSenderNonceSet, senderNonceId) == 1 then
                    return "nonce_conflict"
                end

                return nil
            `
        })
    }

    async startProcessing(userOpInfo: UserOpInfo): Promise<void> {
        const { userOpHash, userOp } = userOpInfo
        const isDeploymentOp = isDeployment(userOp)
        const senderNonceId = this.encodeSenderNonceId(
            userOp.sender,
            userOp.nonce
        )

        await this.redis.startProcessing(
            this.processingUserOpsSet,
            this.processingSenderNonceSet,
            this.processingDeploymentSet,
            userOpHash,
            senderNonceId,
            userOp.sender,
            isDeploymentOp ? "true" : "false"
        )
    }

    async finishProcessing(userOpInfo: UserOpInfo): Promise<void> {
        const { userOpHash, userOp } = userOpInfo
        const senderNonceId = this.encodeSenderNonceId(
            userOp.sender,
            userOp.nonce
        )

        await this.redis.finishProcessing(
            this.processingUserOpsSet,
            this.processingSenderNonceSet,
            this.processingDeploymentSet,
            userOpHash,
            senderNonceId,
            userOp.sender
        )
    }

    async isProcessing(userOpHash: Hex): Promise<boolean> {
        const isMember = await this.redis.sismember(
            this.processingUserOpsSet,
            userOpHash
        )
        return isMember === 1
    }

    async wouldConflict(
        userOp: UserOperation
    ): Promise<"nonce_conflict" | "deployment_conflict" | undefined> {
        const senderNonceId = this.encodeSenderNonceId(
            userOp.sender,
            userOp.nonce
        )

        const result = await this.redis.checkConflict(
            this.processingSenderNonceSet,
            this.processingDeploymentSet,
            senderNonceId,
            userOp.sender
        )

        return result === null
            ? undefined
            : (result as "nonce_conflict" | "deployment_conflict")
    }
}
