import {
    EntryPointAbi,
    RpcError,
    type StakeInfo,
    ValidationErrors,
    type ValidationResult,
    type ValidationResultWithAggregation,
    type UnPackedUserOperation
} from "@entrypoint-0.7/types"
import type { Logger } from "@alto/utils"
import { type Address, type PublicClient, getAddress, getContract } from "viem"

export interface InterfaceReputationManager {
    checkReputation(
        userOperation: UnPackedUserOperation,
        validationResult: ValidationResult | ValidationResultWithAggregation
    ): Promise<void>
    updateUserOperationSeenStatus(userOperation: UnPackedUserOperation): void
    increaseUserOperationCount(userOperation: UnPackedUserOperation): void
    decreaseUserOperationCount(userOperation: UnPackedUserOperation): void
    getStatus(address: Address | null): ReputationStatus
    updateUserOperationIncludedStatus(
        userOperation: UnPackedUserOperation,
        accountDeployed: boolean
    ): void
    crashedHandleOps(userOperation: UnPackedUserOperation, reason: string): void
    setReputation(
        args: {
            address: Address
            opsSeen: bigint
            opsIncluded: bigint
        }[]
    ): void
    dumpReputations(): ReputationEntry[]
    getStakeStatus(address: Address): Promise<{
        stakeInfo: StakeInfo
        isStaked: boolean
    }>
    clear(): void
    clearEntityCount(): void
}

export enum EntityType {
    Account = "Account",
    Paymaster = "Paymaster",
    Factory = "Factory",
    Aggregator = "Aggregator"
}

export type ReputationStatus = 0n | 1n | 2n
export const ReputationStatuses: {
    ok: ReputationStatus
    throttled: ReputationStatus
    banned: ReputationStatus
} = {
    ok: 0n,
    throttled: 1n,
    banned: 2n
}

export interface ReputationEntry {
    address: Address
    opsSeen: bigint
    opsIncluded: bigint
    status?: ReputationStatus
}

export interface ReputationParams {
    minInclusionDenominator: bigint
    throttlingSlack: bigint
    banSlack: bigint
}

export const BundlerReputationParams: ReputationParams = {
    minInclusionDenominator: 10n,
    throttlingSlack: 10n,
    banSlack: 50n
}

export class NullReputationManager implements InterfaceReputationManager {
    checkReputation(
        _userOperation: UnPackedUserOperation,
        _validationResult: ValidationResult | ValidationResultWithAggregation
    ): Promise<void> {
        return Promise.resolve()
    }

    increaseUserOperationCount(_: UnPackedUserOperation): void {
        return
    }

    decreaseUserOperationCount(_: UnPackedUserOperation): void {
        return
    }

    updateUserOperationSeenStatus(_: UnPackedUserOperation): void {
        return
    }

    updateUserOperationIncludedStatus(
        _: UnPackedUserOperation,
        __: boolean
    ): void {
        return
    }

    crashedHandleOps(_: UnPackedUserOperation, __: string): void {
        return
    }

    setReputation(
        _: {
            address: Address
            opsSeen: bigint
            opsIncluded: bigint
        }[]
    ): void {
        return
    }

    dumpReputations(): ReputationEntry[] {
        return []
    }

    getStatus(_address: Address | null): ReputationStatus {
        throw new Error("Method not implemented.")
    }

    getStakeStatus(_: Address): Promise<{
        stakeInfo: StakeInfo
        isStaked: boolean
    }> {
        throw new Error("Method not implemented.")
    }

    clear(): void {
        return
    }

    clearEntityCount(): void {
        return
    }
}

export class ReputationManager implements InterfaceReputationManager {
    private publicClient: PublicClient
    private entryPoint: Address
    private minStake: bigint
    private minUnstakeDelay: bigint
    private entityCount: { [address: Address]: bigint } = {}
    private throttledEntityMinMempoolCount: bigint
    private maxMempoolUserOperationsPerSender: bigint
    private maxMempoolUserOperationsPerNewUnstakedEntity: bigint
    private inclusionRateFactor: bigint
    private entries: { [address: Address]: ReputationEntry } = {}
    private whitelist: Set<Address> = new Set()
    private blackList: Set<Address> = new Set()
    private bundlerReputationParams: ReputationParams
    private logger: Logger

    constructor(
        publicClient: PublicClient,
        entryPoint: Address,
        minStake: bigint,
        minUnstakeDelay: bigint,
        logger: Logger,
        maxMempoolUserOperationsPerNewUnstakedEntity?: bigint,
        throttledEntityMinMempoolCount?: bigint,
        inclusionRateFactor?: bigint,
        maxMempoolUserOperationsPerSender?: bigint,
        blackList?: Address[],
        whiteList?: Address[],
        bundlerReputationParams?: ReputationParams
    ) {
        this.publicClient = publicClient
        this.entryPoint = entryPoint
        this.minStake = minStake
        this.minUnstakeDelay = minUnstakeDelay
        this.logger = logger
        this.maxMempoolUserOperationsPerNewUnstakedEntity =
            maxMempoolUserOperationsPerNewUnstakedEntity ?? 10n
        this.inclusionRateFactor = inclusionRateFactor ?? 10n
        this.throttledEntityMinMempoolCount =
            throttledEntityMinMempoolCount ?? 4n
        this.maxMempoolUserOperationsPerSender =
            maxMempoolUserOperationsPerSender ?? 4n
        this.bundlerReputationParams =
            bundlerReputationParams ?? BundlerReputationParams
        for (const address of blackList || []) {
            this.blackList.add(address)
        }
        for (const address of whiteList || []) {
            this.whitelist.add(address)
        }
    }

    setReputation(
        reputations: {
            address: Address
            opsSeen: bigint
            opsIncluded: bigint
        }[]
    ): void {
        for (const reputation of reputations) {
            const address = getAddress(reputation.address)
            this.entries[address] = {
                address,
                opsSeen: BigInt(reputation.opsSeen),
                opsIncluded: BigInt(reputation.opsIncluded)
            }
        }
        this.logger.debug(
            {
                reputations: this.entries
            },
            "Reputation set"
        )
    }

    dumpReputations(): ReputationEntry[] {
        return Object.values(this.entries).map((entry) => ({
            ...entry,
            status: this.getStatus(entry.address)
        }))
    }

    clear(): void {
        this.entries = {}
        this.entityCount = {}
    }

    clearEntityCount(): void {
        this.entityCount = {}
    }

    async getStakeStatus(address: Address): Promise<{
        stakeInfo: StakeInfo
        isStaked: boolean
    }> {
        const entryPoint = getContract({
            abi: EntryPointAbi,
            address: this.entryPoint,
            publicClient: this.publicClient
        })
        const stakeInfo = await entryPoint.read.getDepositInfo([address])

        const stake = BigInt(stakeInfo.stake)
        const unstakeDelaySec = BigInt(stakeInfo.unstakeDelaySec)

        const isStaked =
            stake >= this.minStake && unstakeDelaySec >= this.minUnstakeDelay

        return {
            stakeInfo: {
                addr: address,
                stake: stake,
                unstakeDelaySec: unstakeDelaySec
            },
            isStaked
        }
    }

    checkReputation(
        userOperation: UnPackedUserOperation,
        validationResult: ValidationResult | ValidationResultWithAggregation
    ): Promise<void> {
        this.increaseUserOperationCount(userOperation)

        this.checkReputationStatus(
            EntityType.Account,
            validationResult.senderInfo,
            this.maxMempoolUserOperationsPerSender
        )

        if (validationResult.paymasterInfo) {
            this.checkReputationStatus(
                EntityType.Paymaster,
                validationResult.paymasterInfo
            )
        }

        if (validationResult.factoryInfo) {
            this.checkReputationStatus(
                EntityType.Factory,
                validationResult.factoryInfo
            )
        }

        const aggregatorValidationResult =
            validationResult as ValidationResultWithAggregation
        if (aggregatorValidationResult.aggregatorInfo) {
            this.checkReputationStatus(
                EntityType.Aggregator,
                aggregatorValidationResult.aggregatorInfo.stakeInfo
            )
        }

        return Promise.resolve()
    }

    getEntityCount(address: Address): bigint {
        return this.entityCount[address] ?? 0
    }

    increaseSeen(address: Address): void {
        const entry = this.entries[address]
        if (!entry) {
            this.entries[address] = {
                address,
                opsSeen: 1n,
                opsIncluded: 0n
            }
            return
        }
        entry.opsSeen++
    }

    updateCrashedHandleOps(address: Address): void {
        const entry = this.entries[address]
        if (!entry) {
            this.entries[address] = {
                address,
                opsSeen: 1000n,
                opsIncluded: 0n
            }
            return
        }
        entry.opsSeen = 1000n
        entry.opsIncluded = 0n
    }

    crashedHandleOps(op: UnPackedUserOperation, reason: string): void {
        if (reason.startsWith("AA3")) {
            // paymaster
            if (op.paymaster) {
                this.updateCrashedHandleOps(op.paymaster)
            }
        } else if (reason.startsWith("AA2")) {
            // sender
            const sender = op.sender
            this.updateCrashedHandleOps(sender)
        } else if (reason.startsWith("AA1")) {
            // init code
            if (op.factory) {
                this.updateCrashedHandleOps(op.factory)
            }
        }
    }

    updateIncludedStatus(address: Address): void {
        const entry = this.entries[address]
        if (!entry) {
            this.entries[address] = {
                address,
                opsSeen: 0n,
                opsIncluded: 1n
            }
            return
        }
        entry.opsIncluded++
    }

    updateUserOperationIncludedStatus(
        userOperation: UnPackedUserOperation,
        accountDeployed: boolean
    ): void {
        const sender = userOperation.sender
        this.updateIncludedStatus(sender)

        if (userOperation.paymaster) {
            this.updateIncludedStatus(userOperation.paymaster)
        }

        if (accountDeployed) {
            if (userOperation.factory) {
                this.updateIncludedStatus(userOperation.factory)
            }
        }
    }

    updateUserOperationSeenStatus(userOperation: UnPackedUserOperation): void {
        const sender = userOperation.sender
        this.increaseSeen(sender)

        if (userOperation.paymaster) {
            this.increaseSeen(userOperation.paymaster)
        }

        if (userOperation.factory) {
            this.increaseSeen(userOperation.factory)
        }
    }

    increaseUserOperationCount(userOperation: UnPackedUserOperation) {
        const sender = userOperation.sender
        this.entityCount[sender] = (this.entityCount[sender] ?? 0n) + 1n

        if (userOperation.paymaster) {
            this.entityCount[userOperation.paymaster] =
                (this.entityCount[userOperation.paymaster] ?? 0n) + 1n
        }

        if (userOperation.factory) {
            this.entityCount[userOperation.factory] =
                (this.entityCount[userOperation.factory] ?? 0n) + 1n
        }
    }

    decreaseUserOperationCount(userOperation: UnPackedUserOperation) {
        const sender = userOperation.sender
        this.entityCount[sender] = (this.entityCount[sender] ?? 0n) - 1n

        this.entityCount[sender] =
            this.entityCount[sender] < 0n ? 0n : this.entityCount[sender]

        const paymaster = userOperation.paymaster
        if (paymaster) {
            this.entityCount[paymaster] =
                (this.entityCount[paymaster] ?? 0n) - 1n

            this.entityCount[paymaster] =
                this.entityCount[paymaster] < 0n
                    ? 0n
                    : this.entityCount[paymaster]
        }

        const factory = userOperation.factory
        if (factory) {
            this.entityCount[factory] = (this.entityCount[factory] ?? 0n) - 1n

            this.entityCount[factory] =
                this.entityCount[factory] < 0n ? 0n : this.entityCount[factory]
        }
    }

    checkReputationStatus(
        entityType: EntityType,
        stakeInfo: StakeInfo,
        maxMempoolUserOperationsPerSenderOverride?: bigint
    ) {
        const maxTxMempoolAllowedEntity =
            maxMempoolUserOperationsPerSenderOverride ??
            this.calCulateMaxMempoolUserOperationsPerEntity(
                stakeInfo.addr as Address
            )

        this.checkBanned(entityType, stakeInfo)

        const entityCount = this.getEntityCount(stakeInfo.addr as Address)

        if (entityCount > this.throttledEntityMinMempoolCount) {
            this.checkThrottled(entityType, stakeInfo)
        }
        if (entityCount > maxTxMempoolAllowedEntity) {
            this.checkStake(entityType, stakeInfo)
        }
    }

    getStatus(address: Address | null): ReputationStatus {
        if (!address || this.whitelist.has(address)) {
            return ReputationStatuses.ok
        }
        if (this.blackList.has(address)) {
            return ReputationStatuses.banned
        }
        const entry = this.entries[address]
        if (!entry) {
            return ReputationStatuses.ok
        }
        const minExpectedIncluded =
            entry.opsSeen / this.bundlerReputationParams.minInclusionDenominator

        this.logger.debug(
            {
                address: address,
                minExpectedIncluded,
                opsSeen: entry.opsSeen,
                minInclusionDenominator:
                    this.bundlerReputationParams.minInclusionDenominator,
                opsIncluded: entry.opsIncluded,
                throttlingSlack: this.bundlerReputationParams.throttlingSlack,
                banSlack: this.bundlerReputationParams.banSlack
            },
            "minExpectedIncluded"
        )

        if (
            minExpectedIncluded <=
            entry.opsIncluded + this.bundlerReputationParams.throttlingSlack
        ) {
            entry.status = ReputationStatuses.ok
            return ReputationStatuses.ok
        }

        if (
            minExpectedIncluded <=
            entry.opsIncluded + this.bundlerReputationParams.banSlack
        ) {
            entry.status = ReputationStatuses.throttled
            return ReputationStatuses.throttled
        }

        entry.status = ReputationStatuses.banned
        return ReputationStatuses.banned
    }

    checkBanned(entityType: EntityType, stakeInfo: StakeInfo) {
        const status = this.getStatus(stakeInfo.addr as Address)
        if (status === ReputationStatuses.banned) {
            throw new RpcError(
                `${entityType} ${stakeInfo.addr} is banned from using the pimlico`,
                ValidationErrors.Reputation
            )
        }
    }

    checkThrottled(entityType: EntityType, stakeInfo: StakeInfo) {
        const status = this.getStatus(stakeInfo.addr as Address)
        if (status === ReputationStatuses.throttled) {
            throw new RpcError(
                `${entityType} ${stakeInfo.addr} is throttled by the pimlico`,
                ValidationErrors.Reputation
            )
        }
    }

    isWhiteListed(address: Address): boolean {
        return this.whitelist.has(address)
    }

    checkStake(entityType: EntityType, stakeInfo: StakeInfo) {
        if (this.isWhiteListed(stakeInfo.addr as Address)) {
            return
        }
        this.checkBanned(entityType, stakeInfo)

        if (stakeInfo.stake < this.minStake) {
            if (stakeInfo.stake === 0n) {
                throw new RpcError(
                    `${entityType} ${stakeInfo.addr} is unstaked and must stake minimum ${this.minStake} to use pimlico`,
                    ValidationErrors.InsufficientStake
                )
            }

            throw new RpcError(
                `${entityType} ${stakeInfo.addr} does not have enough stake to use pimlico`,
                ValidationErrors.InsufficientStake
            )
        }

        if (stakeInfo.unstakeDelaySec < this.minUnstakeDelay) {
            throw new RpcError(
                `${entityType} ${stakeInfo.addr} does not have enough unstake delay to use pimlico`,
                ValidationErrors.InsufficientStake
            )
        }
    }

    calCulateMaxMempoolUserOperationsPerEntity(address: Address): bigint {
        const entry = this.entries[address]
        if (!entry) {
            return this.maxMempoolUserOperationsPerNewUnstakedEntity
        }
        let inclusionRate = 0n
        if (entry.opsSeen !== 0n) {
            // prevent NaN of Infinity in tests
            inclusionRate = entry.opsIncluded / entry.opsSeen
        }
        return (
            this.maxMempoolUserOperationsPerNewUnstakedEntity +
            inclusionRate * this.inclusionRateFactor +
            (entry.opsIncluded > 10000n ? 10000n : entry.opsIncluded)
        )
    }
}
