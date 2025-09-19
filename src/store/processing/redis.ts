import type { ProcessingStore } from "@alto/store"
import type { UserOpInfo, UserOperation } from "@alto/types"
import { isDeployment } from "@alto/utils"
import { Redis } from "ioredis"
import type { Logger } from "pino"
import type { Address, Hex } from "viem"
import type { AltoConfig } from "../../createConfig"

export class RedisProcessingStore implements ProcessingStore {
    private redis: Redis
    private logger: Logger

    private processingUserOpsSet: string // set of userOpHashes being processed
    private processingSenderNonceSet: string // set of "sender:nonce" being processed
    private processingDeploymentSet: string // set of senders with deployments being processed

    private encodeSenderNonceId(sender: Address, nonce: bigint): string {
        return `${sender}:${nonce}`
    }

    constructor({
        config,
        entryPoint,
        redisEndpoint,
        logger
    }: {
        config: AltoConfig
        entryPoint: Address
        redisEndpoint: string
        logger: Logger
    }) {
        this.redis = new Redis(redisEndpoint)
        this.logger = logger

        const redisPrefix = `${config.redisKeyPrefix}:${config.chainId}:${entryPoint}:processing`
        this.processingUserOpsSet = `${redisPrefix}:userOps`
        this.processingSenderNonceSet = `${redisPrefix}:senderNonce`
        this.processingDeploymentSet = `${redisPrefix}:deployment`
    }

    async startProcessing(userOpInfo: UserOpInfo): Promise<void> {
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

        const start = performance.now()
        await multi.exec()
        const duration = (performance.now() - start).toFixed(2)
        this.logger.info(`[debug-redis] startProcessing took ${duration}ms`)
    }

    async finishProcessing(userOpInfo: UserOpInfo): Promise<void> {
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

        const start = performance.now()
        await multi.exec()
        const duration = (performance.now() - start).toFixed(2)
        this.logger.info(`[debug-redis] finishProcessing took ${duration}ms`)
    }

    async isProcessing(userOpHash: Hex): Promise<boolean> {
        const start = performance.now()
        const isMember = await this.redis.sismember(
            this.processingUserOpsSet,
            userOpHash
        )
        const duration = (performance.now() - start).toFixed(2)
        this.logger.info(`[debug-redis] isProcessing took ${duration}ms`)
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

        const start = performance.now()
        const results = await multi.exec()
        const duration = (performance.now() - start).toFixed(2)
        this.logger.info(`[debug-redis] wouldConflict took ${duration}ms`)
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
