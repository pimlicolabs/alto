import {
    EntryPointAbi,
    RpcError,
    type StakeInfo,
    type UserOperation,
    ValidationErrors,
    type ValidationResult,
    type ValidationResultWithAggregation
} from "@entrypoint-0.6/types"
import type { Logger } from "@alto/utils"
import { getAddressFromInitCodeOrPaymasterAndData } from "@entrypoint-0.6/utils"
import { type Address, type PublicClient, getAddress, getContract } from "viem"

export interface InterfaceReputationManager {
    checkReputation(
        userOperation: UserOperation,
        validationResult: ValidationResult | ValidationResultWithAggregation
    ): Promise<void>
    updateUserOperationSeenStatus(userOperation: UserOperation): void
    increaseUserOperationCount(userOperation: UserOperation): void
    decreaseUserOperationCount(userOperation: UserOperation): void
    getStatus(address?: Address): ReputationStatus
    updateUserOperationIncludedStatus(
        userOperation: UserOperation,
        accountDeployed: boolean
    ): void
    crashedHandleOps(userOperation: UserOperation, reason: string): void
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
    ACCOUNT = "Account",
    PAYMASTER = "Paymaster",
    FACTORY = "Factory",
    AGGREGATOR = "Aggregator"
}

export type ReputationStatus = 0n | 1n | 2n
export const ReputationStatuses: {
    OK: ReputationStatus
    THROTTLED: ReputationStatus
    BANNED: ReputationStatus
} = {
    OK: 0n,
    THROTTLED: 1n,
    BANNED: 2n
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
    async checkReputation(
        userOperation: UserOperation,
        validationResult: ValidationResult | ValidationResultWithAggregation
    ): Promise<void> {
        return
    }

    increaseUserOperationCount(_: UserOperation): void {
        return
    }

    decreaseUserOperationCount(_: UserOperation): void {
        return
    }

    updateUserOperationSeenStatus(_: UserOperation): void {
        return
    }

    updateUserOperationIncludedStatus(_: UserOperation, __: boolean): void {
        return
    }

    crashedHandleOps(_: UserOperation, __: string): void {
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

    getStatus(_address?: `0x${string}` | undefined): ReputationStatus {
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

    async checkReputation(
        userOperation: UserOperation,
        validationResult: ValidationResult | ValidationResultWithAggregation
    ): Promise<void> {
        this.increaseUserOperationCount(userOperation)

        this.checkReputationStatus(
            EntityType.ACCOUNT,
            validationResult.senderInfo,
            this.maxMempoolUserOperationsPerSender
        )

        if (validationResult.paymasterInfo) {
            this.checkReputationStatus(
                EntityType.PAYMASTER,
                validationResult.paymasterInfo
            )
        }

        if (validationResult.factoryInfo) {
            this.checkReputationStatus(
                EntityType.FACTORY,
                validationResult.factoryInfo
            )
        }

        const aggregaorValidationResult =
            validationResult as ValidationResultWithAggregation
        if (aggregaorValidationResult.aggregatorInfo) {
            this.checkReputationStatus(
                EntityType.AGGREGATOR,
                aggregaorValidationResult.aggregatorInfo.stakeInfo
            )
        }
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

    crashedHandleOps(op: UserOperation, reason: string): void {
        if (reason.startsWith("AA3")) {
            // paymaster
            const paymaster = getAddressFromInitCodeOrPaymasterAndData(
                op.paymasterAndData
            ) as Address | undefined
            if (paymaster) {
                this.updateCrashedHandleOps(paymaster)
            }
        } else if (reason.startsWith("AA2")) {
            // sender
            const sender = op.sender
            this.updateCrashedHandleOps(sender)
        } else if (reason.startsWith("AA1")) {
            // init code
            const factory = getAddressFromInitCodeOrPaymasterAndData(
                op.initCode
            ) as Address | undefined
            if (factory) {
                this.updateCrashedHandleOps(factory)
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
        userOperation: UserOperation,
        accountDeployed: boolean
    ): void {
        const sender = userOperation.sender
        this.updateIncludedStatus(sender)

        const paymaster = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.paymasterAndData
        ) as Address | undefined
        if (paymaster) {
            this.updateIncludedStatus(paymaster)
        }

        if (accountDeployed) {
            const factory = getAddressFromInitCodeOrPaymasterAndData(
                userOperation.initCode
            ) as Address | undefined
            if (factory) {
                this.updateIncludedStatus(factory)
            }
        }
    }

    updateUserOperationSeenStatus(userOperation: UserOperation): void {
        const sender = userOperation.sender
        this.increaseSeen(sender)

        const paymaster = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.paymasterAndData
        ) as Address | undefined
        if (paymaster) {
            this.increaseSeen(paymaster)
        }

        const factory = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.initCode
        ) as Address | undefined

        this.logger.debug(
            { userOperation, factory },
            "updateUserOperationSeenStatus"
        )

        if (factory) {
            this.increaseSeen(factory)
        }
    }

    increaseUserOperationCount(userOperation: UserOperation) {
        const sender = userOperation.sender
        this.entityCount[sender] = (this.entityCount[sender] ?? 0n) + 1n

        const paymaster = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.paymasterAndData
        )
        if (paymaster) {
            this.entityCount[paymaster] =
                (this.entityCount[paymaster] ?? 0n) + 1n
        }

        const factory = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.initCode
        )
        if (factory) {
            this.entityCount[factory] = (this.entityCount[factory] ?? 0n) + 1n
        }
    }

    decreaseUserOperationCount(userOperation: UserOperation) {
        const sender = userOperation.sender
        this.entityCount[sender] = (this.entityCount[sender] ?? 0n) - 1n

        this.entityCount[sender] =
            this.entityCount[sender] < 0n ? 0n : this.entityCount[sender]

        const paymaster = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.paymasterAndData
        )
        if (paymaster) {
            this.entityCount[paymaster] =
                (this.entityCount[paymaster] ?? 0n) - 1n

            this.entityCount[paymaster] =
                this.entityCount[paymaster] < 0n
                    ? 0n
                    : this.entityCount[paymaster]
        }

        const factory = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.initCode
        )
        if (factory) {
            this.entityCount[factory] = (this.entityCount[factory] ?? 0n) - 1n

            this.entityCount[factory] =
                this.entityCount[factory] < 0n ? 0n : this.entityCount[factory]
        }
    }

    checkReputationStatus(
        entyType: EntityType,
        stakeInfo: StakeInfo,
        maxMempoolUserOperationsPerSenderOverride?: bigint
    ) {
        const maxTxMempoolAllowedEntity =
            maxMempoolUserOperationsPerSenderOverride ??
            this.calCulateMaxMempoolUserOperationsPerEntity(
                stakeInfo.addr as Address
            )

        this.checkBanned(entyType, stakeInfo)

        const entityCount = this.getEntityCount(stakeInfo.addr as Address)

        if (entityCount > this.throttledEntityMinMempoolCount) {
            this.checkThrottled(entyType, stakeInfo)
        }
        if (entityCount > maxTxMempoolAllowedEntity) {
            this.checkStake(entyType, stakeInfo)
        }
    }

    getStatus(address?: Address): ReputationStatus {
        if (!address || this.whitelist.has(address)) {
            return ReputationStatuses.OK
        }
        if (this.blackList.has(address)) {
            return ReputationStatuses.BANNED
        }
        const entry = this.entries[address]
        if (!entry) {
            return ReputationStatuses.OK
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
            entry.status = ReputationStatuses.OK
            return ReputationStatuses.OK
        } else if (
            minExpectedIncluded <=
            entry.opsIncluded + this.bundlerReputationParams.banSlack
        ) {
            entry.status = ReputationStatuses.THROTTLED
            return ReputationStatuses.THROTTLED
        } else {
            entry.status = ReputationStatuses.BANNED
            return ReputationStatuses.BANNED
        }
    }

    checkBanned(entityType: EntityType, stakeInfo: StakeInfo) {
        const status = this.getStatus(stakeInfo.addr as Address)
        if (status === ReputationStatuses.BANNED) {
            throw new RpcError(
                `${entityType} ${stakeInfo.addr} is banned from using the pimlico`,
                ValidationErrors.Reputation
            )
        }
    }

    checkThrottled(entityType: EntityType, stakeInfo: StakeInfo) {
        const status = this.getStatus(stakeInfo.addr as Address)
        if (status === ReputationStatuses.THROTTLED) {
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
