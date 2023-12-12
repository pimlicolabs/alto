import {
    RpcError,
    StakeInfo,
    UserOperation,
    ValidationErrors,
    ValidationResult,
    ValidationResultWithAggregation
} from "@alto/types"
import { getAddressFromInitCodeOrPaymasterAndData } from "@alto/utils"
import { Address } from "viem"

export interface IReputationManager {
    checkReputation(
        userOperation: UserOperation,
        validationResult: ValidationResult | ValidationResultWithAggregation
    ): Promise<void>
    updateUserOperationSeenStatus(userOperation: UserOperation): void
    increaseUserOperationCount(userOperation: UserOperation): void
    decreaseUserOperationCount(userOperation: UserOperation): void
    updateUserOperationIncludedStatus(
        userOperation: UserOperation,
        accountDeployed: boolean
    ): void
    crashedHandleOps(userOperation: UserOperation, reason: string): void
    setReputation(
        args: {
            address: Address
            opsSeen: number
            opsIncluded: number
        }[]
    ): void
}

export enum EntityType {
    ACCOUNT = "Account",
    PAYMASTER = "Paymaster",
    FACTORY = "Factory",
    AGGREGATOR = "Aggregator"
}

export enum ReputationStatus {
    OK,
    THROTTLED,
    BANNED
}

export interface ReputationEntry {
    address: Address
    opsSeen: number
    opsIncluded: number
    status?: ReputationStatus
}

export interface ReputationParams {
    minInclusionDenominator: number
    throttlingSlack: number
    banSlack: number
}

export const BundlerReputationParams: ReputationParams = {
    minInclusionDenominator: 10,
    throttlingSlack: 10,
    banSlack: 50
}

export class NullRepuationManager implements IReputationManager {
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
            opsSeen: number
            opsIncluded: number
        }[]
    ): void {
        return
    }
}

export class ReputationManager implements IReputationManager {
    private minStake: bigint
    private minUnstakeDelay: bigint
    private entityCount: { [address: Address]: number } = {}
    private throttledEntityMinMempoolCount: number
    private maxMempoolUserOperationsPerSender: number
    private maxMempoolUserOperationsPerNewUnstakedEntity: number
    private inclusionRateFactor: number
    private entries: { [address: Address]: ReputationEntry } = {}
    private whitelist: Set<Address> = new Set()
    private blackList: Set<Address> = new Set()
    private bundlerReputationParams: ReputationParams

    constructor(
        minStake: bigint,
        minUnstakeDelay: bigint,
        maxMempoolUserOperationsPerNewUnstakedEntity?: number,
        throttledEntityMinMempoolCount?: number,
        inclusionRateFactor?: number,
        maxMempoolUserOperationsPerSender?: number,
        blackList?: Address[],
        whiteList?: Address[],
        bundlerReputationParams?: ReputationParams
    ) {
        this.minStake = minStake
        this.minUnstakeDelay = minUnstakeDelay
        this.maxMempoolUserOperationsPerNewUnstakedEntity =
            maxMempoolUserOperationsPerNewUnstakedEntity ?? 10
        this.inclusionRateFactor = inclusionRateFactor ?? 10
        this.throttledEntityMinMempoolCount =
            throttledEntityMinMempoolCount ?? 4
        this.maxMempoolUserOperationsPerSender =
            maxMempoolUserOperationsPerSender ?? 4
        this.bundlerReputationParams =
            bundlerReputationParams ?? BundlerReputationParams
        for (const address of blackList || []) {
            this.blackList.add(address.toLowerCase() as Address)
        }
        for (const address of whiteList || []) {
            this.whitelist.add(address.toLowerCase() as Address)
        }
    }

    setReputation(
        reputations: {
            address: Address
            opsSeen: number
            opsIncluded: number
        }[]
    ): void {
        for (const reputation of reputations) {
            const address = reputation.address.toLowerCase() as Address
            this.entries[address] = {
                address: reputation.address,
                opsSeen: reputation.opsSeen,
                opsIncluded: reputation.opsIncluded
            }
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

    getEntityCount(address: Address): number {
        return this.entityCount[address.toLowerCase() as Address] ?? 0
    }

    increaseSeen(address: Address): void {
        const entry = this.entries[address.toLowerCase() as Address]
        if (!entry) {
            this.entries[address.toLowerCase() as Address] = {
                address,
                opsSeen: 1,
                opsIncluded: 0
            }
            return
        }
        entry.opsSeen++
    }

    updateCrashedHandleOps(address: Address): void {
        const entry = this.entries[address.toLowerCase() as Address]
        if (!entry) {
            this.entries[address.toLowerCase() as Address] = {
                address,
                opsSeen: 10000,
                opsIncluded: 0
            }
            return
        }
        entry.opsSeen += 10000
        entry.opsIncluded = 0
    }

    crashedHandleOps(userOperation: UserOperation, reason: string): void {
        if (reason.startsWith("AA3")) {
            // paymaster
            let paymaster = getAddressFromInitCodeOrPaymasterAndData(
                userOperation.paymasterAndData
            ) as Address | undefined
            if (paymaster) {
                this.updateCrashedHandleOps(paymaster)
            }
        } else if (reason.startsWith("AA2")) {
            // sender
            const sender = userOperation.sender
            this.updateCrashedHandleOps(sender)
        } else if (reason.startsWith("AA1")) {
            // init code
            let factory = getAddressFromInitCodeOrPaymasterAndData(
                userOperation.initCode
            ) as Address | undefined
            if (factory) {
                this.updateCrashedHandleOps(factory)
            }
        }
    }

    updateIncludedStatus(address: Address): void {
        const entry = this.entries[address.toLowerCase() as Address]
        if (!entry) {
            this.entries[address.toLowerCase() as Address] = {
                address,
                opsSeen: 1,
                opsIncluded: 1
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

        let paymaster = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.paymasterAndData
        ) as Address | undefined
        if (paymaster) {
            this.updateIncludedStatus(paymaster)
        }

        if (accountDeployed) {
            let factory = getAddressFromInitCodeOrPaymasterAndData(
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

        let paymaster = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.paymasterAndData
        ) as Address | undefined
        if (paymaster) {
            this.increaseSeen(paymaster)
        }

        let factory = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.initCode
        ) as Address | undefined

        if (factory) {
            this.increaseSeen(factory)
        }
    }

    increaseUserOperationCount(userOperation: UserOperation) {
        const sender = userOperation.sender.toLowerCase() as Address
        this.entityCount[sender] = (this.entityCount[sender] ?? 0) + 1

        let paymaster = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.paymasterAndData
        )?.toLowerCase() as Address | undefined
        if (paymaster) {
            this.entityCount[paymaster] = (this.entityCount[paymaster] ?? 0) + 1
        }

        let factory = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.initCode
        )?.toLowerCase() as Address | undefined
        if (factory) {
            this.entityCount[factory] = (this.entityCount[factory] ?? 0) + 1
        }
    }

    decreaseUserOperationCount(userOperation: UserOperation) {
        const sender = userOperation.sender.toLowerCase() as Address
        this.entityCount[sender] = Math.max(
            0,
            (this.entityCount[sender] ?? 0) - 1
        )

        let paymaster = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.paymasterAndData
        )?.toLowerCase() as Address | undefined
        if (paymaster) {
            this.entityCount[paymaster] = Math.max(
                0,
                (this.entityCount[paymaster] ?? 0) - 1
            )
        }

        let factory = getAddressFromInitCodeOrPaymasterAndData(
            userOperation.initCode
        )?.toLowerCase() as Address | undefined
        if (factory) {
            this.entityCount[factory] = Math.max(
                0,
                (this.entityCount[factory] ?? 0) - 1
            )
        }
    }

    checkReputationStatus(
        entyType: EntityType,
        stakeInfo: StakeInfo,
        maxMempoolUserOperationsPerSenderOverride?: number
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
        address = address?.toLowerCase() as Address
        if (!address || this.whitelist.has(address)) {
            return ReputationStatus.OK
        }
        if (this.blackList.has(address)) {
            return ReputationStatus.BANNED
        }
        const entry = this.entries[address]
        if (!entry) {
            return ReputationStatus.OK
        }
        const minExpectedIncluded = Math.floor(
            entry.opsSeen / this.bundlerReputationParams.minInclusionDenominator
        )
        if (
            minExpectedIncluded <=
            entry.opsIncluded + this.bundlerReputationParams.throttlingSlack
        ) {
            return ReputationStatus.OK
        } else if (
            minExpectedIncluded <=
            entry.opsIncluded + this.bundlerReputationParams.banSlack
        ) {
            return ReputationStatus.THROTTLED
        } else {
            return ReputationStatus.BANNED
        }
    }

    checkBanned(entityType: EntityType, stakeInfo: StakeInfo) {
        const status = this.getStatus(stakeInfo.addr as Address)
        if (status === ReputationStatus.BANNED) {
            throw new RpcError(
                `${entityType} ${stakeInfo.addr} is banned from using the pimlico`,
                ValidationErrors.Reputation
            )
        }
    }

    checkThrottled(entityType: EntityType, stakeInfo: StakeInfo) {
        const status = this.getStatus(stakeInfo.addr as Address)
        if (status === ReputationStatus.THROTTLED) {
            throw new RpcError(
                `${entityType} ${stakeInfo.addr} is throttled by the pimlico`,
                ValidationErrors.Reputation
            )
        }
    }

    isWhiteListed(address: Address): boolean {
        return this.whitelist.has(address.toLowerCase() as Address)
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

    calCulateMaxMempoolUserOperationsPerEntity(address: Address): number {
        address = address.toLowerCase() as Address
        const entry = this.entries[address]
        if (!entry) {
            return this.maxMempoolUserOperationsPerNewUnstakedEntity
        }
        let inclusionRate = 0
        if (entry.opsSeen !== 0) {
            // prevent NaN of Infinity in tests
            inclusionRate = entry.opsIncluded / entry.opsSeen
        }
        return (
            this.maxMempoolUserOperationsPerNewUnstakedEntity +
            Math.floor(inclusionRate * this.inclusionRateFactor) +
            Math.min(entry.opsIncluded, 10000)
        )
    }
}
