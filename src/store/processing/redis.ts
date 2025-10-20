import type { ProcessingStore } from "@alto/store"
import type { UserOpInfo, UserOperation } from "@alto/types"
import { isDeployment } from "@alto/utils"
import { Redis } from "ioredis"
import type { Address, Hex } from "viem"
import type { AltoConfig } from "../../createConfig"

export class RedisProcessingStore implements ProcessingStore {
    private readonly redis: Redis

    private readonly processingUserOpsSet: string // set of userOpHashes being processed
    private readonly processingSenderNonceSet: string // set of "sender:nonce" being processed
    private readonly processingDeploymentSet: string // set of senders with deployments being processed

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
        this.redis = new Redis(redisEndpoint)

        const redisPrefix = `${config.redisKeyPrefix}:${config.chainId}:${entryPoint}:processing`
        this.processingUserOpsSet = `${redisPrefix}:userOps`
        this.processingSenderNonceSet = `${redisPrefix}:senderNonce`
        this.processingDeploymentSet = `${redisPrefix}:deployment`
    }

    async addProcessing(userOpInfo: UserOpInfo): Promise<void> {
        const { userOpHash, userOp } = userOpInfo
        const isDeploymentOp = isDeployment(userOp)
        const senderNonceId = this.encodeSenderNonceId(
            userOp.sender,
            userOp.nonce
        )

        // Use MULTI for atomic operation in single round trip
        const multi = this.redis.multi()
        multi.sadd(this.processingUserOpsSet, userOpHash)
        multi.sadd(this.processingSenderNonceSet, senderNonceId)

        if (isDeploymentOp) {
            multi.sadd(this.processingDeploymentSet, userOp.sender)
        }

        await multi.exec()
    }

    async removeProcessing(userOpInfo: UserOpInfo): Promise<void> {
        const { userOpHash, userOp } = userOpInfo
        const isDeploymentOp = isDeployment(userOp)
        const senderNonceId = this.encodeSenderNonceId(
            userOp.sender,
            userOp.nonce
        )

        // Use MULTI for atomic removal in single round trip
        const multi = this.redis.multi()
        multi.srem(this.processingUserOpsSet, userOpHash)
        multi.srem(this.processingSenderNonceSet, senderNonceId)

        if (isDeploymentOp) {
            multi.srem(this.processingDeploymentSet, userOp.sender)
        }

        await multi.exec()
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

        // Use MULTI for atomic read in single round trip
        const multi = this.redis.multi()
        multi.sismember(this.processingDeploymentSet, userOp.sender)
        multi.sismember(this.processingSenderNonceSet, senderNonceId)

        const results = await multi.exec()
        if (!results) return undefined

        const [deploymentResult, nonceResult] = results
        const hasDeployment = deploymentResult?.[1] === 1
        const hasNonce = nonceResult?.[1] === 1

        if (hasDeployment) {
            return "deployment_conflict"
        }

        if (hasNonce) {
            return "nonce_conflict"
        }

        return undefined
    }
}
