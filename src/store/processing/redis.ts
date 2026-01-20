import type { UserOpInfo, UserOperation } from "@alto/types"
import { isDeployment } from "@alto/utils"
import { Redis } from "ioredis"
import type { Address, Hex } from "viem"
import type { AltoConfig } from "../../createConfig"
import type { ConflictType } from "../types"
import type { ProcessingStore } from "./types"

export class RedisProcessingStore implements ProcessingStore {
    private readonly redis: Redis

    private readonly processingUserOpsSet: string // set of userOpHashes being processed
    private readonly processingSenderNonceSet: string // set of "sender:nonce" being processed
    private readonly processingDeploymentSet: string // set of senders with deployments being processed
    private readonly processingEip7702AuthSet: string // set of senders with eip7702Auth being processed

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
        this.processingEip7702AuthSet = `${redisPrefix}:eip7702Auth`
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

        if (userOp.eip7702Auth) {
            multi.sadd(this.processingEip7702AuthSet, userOp.sender)
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

        if (userOp.eip7702Auth) {
            multi.srem(this.processingEip7702AuthSet, userOp.sender)
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
    ): Promise<ConflictType | undefined> {
        const senderNonceId = this.encodeSenderNonceId(
            userOp.sender,
            userOp.nonce
        )

        // Use MULTI for atomic read in single round trip
        const multi = this.redis.multi()
        multi.sismember(this.processingDeploymentSet, userOp.sender)
        multi.sismember(this.processingEip7702AuthSet, userOp.sender)
        multi.sismember(this.processingSenderNonceSet, senderNonceId)

        const results = await multi.exec()
        if (!results) return undefined

        const [deploymentResult, eip7702AuthResult, nonceResult] = results
        const hasDeployment = deploymentResult?.[1] === 1
        const hasEip7702Auth = eip7702AuthResult?.[1] === 1
        const hasNonce = nonceResult?.[1] === 1

        // Check deployment conflict
        if (isDeployment(userOp) && hasDeployment) {
            return "conflicting_deployment"
        }

        // Check EIP-7702 auth conflict
        if (userOp.eip7702Auth && hasEip7702Auth) {
            return "conflicting_7702_auth"
        }

        // Check nonce conflict
        if (hasNonce) {
            return "conflicting_nonce"
        }

        return undefined
    }

    async clear(): Promise<void> {
        const multi = this.redis.multi()
        multi.del(this.processingUserOpsSet)
        multi.del(this.processingSenderNonceSet)
        multi.del(this.processingDeploymentSet)
        multi.del(this.processingEip7702AuthSet)
        await multi.exec()
    }
}
