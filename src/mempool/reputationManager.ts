import {
    EntryPointV06Abi,
    RpcError,
    type StakeInfo,
    type UserOperation,
    ValidationErrors,
    type ValidationResult,
    type ValidationResultWithAggregation
} from "@alto/types"
import type { Logger } from "@alto/utils"
import {
    getAddressFromInitCodeOrPaymasterAndData,
    isVersion06
} from "@alto/utils"
import { type Address, getAddress, getContract } from "viem"
import type { AltoConfig } from "../createConfig"

export interface InterfaceReputationManager {
    checkReputation(
        userOperation: UserOperation,
        entryPoint: Address,
        validationResult: ValidationResult | ValidationResultWithAggregation
    ): Promise<void>
    updateUserOperationSeenStatus(
        userOperation: UserOperation,
        entryPoint: Address
    ): void
    increaseUserOperationCount(userOperation: UserOperation): void
    decreaseUserOperationCount(userOperation: UserOperation): void
    getStatus(entryPoint: Address, address: Address | null): ReputationStatus
    updateUserOperationIncludedStatus(
        userOperation: UserOperation,
        entryPoint: Address,
        accountDeployed: boolean
    ): void
    crashedHandleOps(
        userOperation: UserOperation,
        entryPoint: Address,
        reason: string
    ): void
    setReputation(
        entryPoint: Address,
        args: {
            address: Address
            opsSeen: bigint
            opsIncluded: bigint
        }[]
    ): void
    dumpReputations(entryPoint: Address): ReputationEntry[]
    getStakeStatus(
        entryPoint: Address,
        address: Address
    ): Promise<{
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
        _userOperation: UserOperation,
        _entryPoint: Address,
        _validationResult: ValidationResult | ValidationResultWithAggregation
    ): Promise<void> {
        return Promise.resolve()
    }

    increaseUserOperationCount(_: UserOperation): void {
        return
    }

    decreaseUserOperationCount(_: UserOperation): void {
        return
    }

    updateUserOperationSeenStatus(
        _: UserOperation,
        _entryPoint: Address
    ): void {
        return
    }

    updateUserOperationIncludedStatus(
        _: UserOperation,
        _entryPoint: Address,
        __: boolean
    ): void {
        return
    }

    crashedHandleOps(_: UserOperation, _entryPoint: Address, __: string): void {
        return
    }

    setReputation(
        _: Address,
        __: {
            address: Address
            opsSeen: bigint
            opsIncluded: bigint
        }[]
    ): void {
        return
    }

    dumpReputations(_entryPoint: Address): ReputationEntry[] {
        return []
    }

    getStatus(
        _entryPoint: Address,
        _address: `0x${string}` | null
    ): ReputationStatus {
        throw new Error("Method not implemented.")
    }

    getStakeStatus(
        _entryPoint: Address,
        _: Address
    ): Promise<{
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
    private config: AltoConfig
    private entityCount: { [address: Address]: bigint } = {}
    private throttledEntityMinMempoolCount: bigint
    private maxMempoolUserOperationsPerSender: bigint
    private maxMempoolUserOperationsPerNewUnstakedEntity: bigint
    private inclusionRateFactor: bigint
    private entries: {
        [entryPoint: Address]: { [address: Address]: ReputationEntry }
    } = {}
    private whitelist: Set<Address> = new Set()
    private blackList: Set<Address> = new Set()
    private bundlerReputationParams: ReputationParams
    private logger: Logger

    constructor(config: AltoConfig) {
        this.config = config
        this.logger = config.getLogger(
            { module: "reputation_manager" },
            {
                level: config.reputationManagerLogLevel || config.logLevel
            }
        )
        this.maxMempoolUserOperationsPerNewUnstakedEntity = 10n
        this.inclusionRateFactor = 10n
        this.throttledEntityMinMempoolCount = 4n
        this.maxMempoolUserOperationsPerSender = 4n
        this.bundlerReputationParams = BundlerReputationParams

        // Currently we don't have any args for blacklist and whitelist
        // for (const address of blackList || []) {
        //     this.blackList.add(address)
        // }
        // for (const address of whiteList || []) {
        //     this.whitelist.add(address)
        // }
        for (const entryPoint of config.entrypoints) {
            this.entries[entryPoint] = {}
        }
    }

    setReputation(
        entryPoint: Address,
        reputations: {
            address: Address
            opsSeen: bigint
            opsIncluded: bigint
        }[]
    ): void {
        for (const reputation of reputations) {
            const address = getAddress(reputation.address)
            this.entries[entryPoint][address] = {
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

    dumpReputations(entryPoint: Address): ReputationEntry[] {
        return Object.values(this.entries[entryPoint]).map((entry) => ({
            ...entry,
            status: this.getStatus(entryPoint, entry.address)
        }))
    }

    clear(): void {
        for (const entryPoint of Object.keys(this.entries)) {
            this.entries[entryPoint as Address] = {}
        }
        this.entityCount = {}
    }

    clearEntityCount(): void {
        this.entityCount = {}
    }

    async getStakeStatus(
        entryPoint: Address,
        address: Address
    ): Promise<{
        stakeInfo: StakeInfo
        isStaked: boolean
    }> {
        const entryPointContract = getContract({
            abi: EntryPointV06Abi,
            address: entryPoint,
            client: {
                public: this.config.publicClient
            }
        })
        const stakeInfo = await entryPointContract.read.getDepositInfo([
            address
        ])

        const stake = BigInt(stakeInfo.stake)
        const unstakeDelaySec = BigInt(stakeInfo.unstakeDelaySec)

        const isStaked =
            stake >= this.config.minEntityStake &&
            unstakeDelaySec >= this.config.minEntityUnstakeDelay

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
        userOperation: UserOperation,
        entryPoint: Address,
        validationResult: ValidationResult | ValidationResultWithAggregation
    ): Promise<void> {
        this.increaseUserOperationCount(userOperation)

        this.checkReputationStatus(
            entryPoint,
            EntityType.Account,
            validationResult.senderInfo,
            this.maxMempoolUserOperationsPerSender
        )

        if (validationResult.paymasterInfo) {
            this.checkReputationStatus(
                entryPoint,
                EntityType.Paymaster,
                validationResult.paymasterInfo
            )
        }

        if (validationResult.factoryInfo) {
            this.checkReputationStatus(
                entryPoint,
                EntityType.Factory,
                validationResult.factoryInfo
            )
        }

        const aggregatorValidationResult =
            validationResult as ValidationResultWithAggregation
        if (aggregatorValidationResult.aggregatorInfo) {
            this.checkReputationStatus(
                entryPoint,
                EntityType.Aggregator,
                aggregatorValidationResult.aggregatorInfo.stakeInfo
            )
        }

        return Promise.resolve()
    }

    getEntityCount(address: Address): bigint {
        return this.entityCount[address] ?? 0
    }

    increaseSeen(entryPoint: Address, address: Address): void {
        let entry = this.entries[entryPoint][address]
        if (!entry) {
            this.entries[entryPoint][address] = {
                address,
                opsSeen: 0n,
                opsIncluded: 0n
            }
            entry = this.entries[entryPoint][address]
        }
        entry.opsSeen++
    }

    updateCrashedHandleOps(entryPoint: Address, address: Address): void {
        const entry = this.entries[entryPoint][address]
        if (!entry) {
            this.entries[entryPoint][address] = {
                address,
                opsSeen: 1000n,
                opsIncluded: 0n
            }
            return
        }
        entry.opsSeen = 1000n
        entry.opsIncluded = 0n
    }

    crashedHandleOps(
        op: UserOperation,
        entryPoint: Address,
        reason: string
    ): void {
        const isUserOpV06 = isVersion06(op)
        if (reason.startsWith("AA3")) {
            // paymaster
            const paymaster = isUserOpV06
                ? getAddressFromInitCodeOrPaymasterAndData(op.paymasterAndData)
                : (op.paymaster as Address | undefined)
            if (paymaster) {
                this.updateCrashedHandleOps(entryPoint, paymaster)
            }
        } else if (reason.startsWith("AA2")) {
            // sender
            const sender = op.sender
            this.updateCrashedHandleOps(entryPoint, sender)
        } else if (reason.startsWith("AA1")) {
            // init code
            const factory = isUserOpV06
                ? getAddressFromInitCodeOrPaymasterAndData(op.initCode)
                : (op.factory as Address | undefined)
            if (factory) {
                this.updateCrashedHandleOps(entryPoint, factory)
            }
        }
    }

    updateIncludedStatus(entryPoint: Address, address: Address): void {
        let entry = this.entries[entryPoint][address]
        if (!entry) {
            this.entries[entryPoint][address] = {
                address,
                opsSeen: 0n,
                opsIncluded: 0n
            }
            entry = this.entries[entryPoint][address]
        }
        entry.opsIncluded++
    }

    updateUserOperationIncludedStatus(
        userOperation: UserOperation,
        entryPoint: Address,
        accountDeployed: boolean
    ): void {
        const sender = userOperation.sender
        this.updateIncludedStatus(entryPoint, sender)
        const isUserOpV06 = isVersion06(userOperation)

        const paymaster = isUserOpV06
            ? getAddressFromInitCodeOrPaymasterAndData(
                  userOperation.paymasterAndData
              )
            : (userOperation.paymaster as Address | undefined)
        if (paymaster) {
            this.updateIncludedStatus(entryPoint, paymaster)
        }

        if (accountDeployed) {
            const factory = (
                isUserOpV06
                    ? getAddressFromInitCodeOrPaymasterAndData(
                          userOperation.initCode
                      )
                    : userOperation.factory
            ) as Address | undefined
            if (factory) {
                this.updateIncludedStatus(entryPoint, factory)
            }
        }
    }

    updateUserOperationSeenStatus(
        userOperation: UserOperation,
        entryPoint: Address
    ): void {
        const sender = userOperation.sender
        this.increaseSeen(entryPoint, sender)
        const isUserOpV06 = isVersion06(userOperation)

        const paymaster = isUserOpV06
            ? getAddressFromInitCodeOrPaymasterAndData(
                  userOperation.paymasterAndData
              )
            : (userOperation.paymaster as Address | undefined)
        if (paymaster) {
            this.increaseSeen(entryPoint, paymaster)
        }

        const factory = (
            isUserOpV06
                ? getAddressFromInitCodeOrPaymasterAndData(
                      userOperation.initCode
                  )
                : userOperation.factory
        ) as Address | undefined

        this.logger.debug(
            { userOperation, factory },
            "updateUserOperationSeenStatus"
        )

        if (factory) {
            this.increaseSeen(entryPoint, factory)
        }
    }

    increaseUserOperationCount(userOperation: UserOperation) {
        const sender = userOperation.sender
        this.entityCount[sender] = (this.entityCount[sender] ?? 0n) + 1n
        const isUserOpV06 = isVersion06(userOperation)

        const paymaster = isUserOpV06
            ? getAddressFromInitCodeOrPaymasterAndData(
                  userOperation.paymasterAndData
              )
            : (userOperation.paymaster as Address | undefined)
        if (paymaster) {
            this.entityCount[paymaster] =
                (this.entityCount[paymaster] ?? 0n) + 1n
        }

        const factory = (
            isUserOpV06
                ? getAddressFromInitCodeOrPaymasterAndData(
                      userOperation.initCode
                  )
                : userOperation.factory
        ) as Address | undefined
        if (factory) {
            this.entityCount[factory] = (this.entityCount[factory] ?? 0n) + 1n
        }
    }

    decreaseUserOperationCount(userOperation: UserOperation) {
        const sender = userOperation.sender
        this.entityCount[sender] = (this.entityCount[sender] ?? 0n) - 1n
        const isUserOpV06 = isVersion06(userOperation)

        this.entityCount[sender] =
            this.entityCount[sender] < 0n ? 0n : this.entityCount[sender]

        const paymaster = isUserOpV06
            ? getAddressFromInitCodeOrPaymasterAndData(
                  userOperation.paymasterAndData
              )
            : (userOperation.paymaster as Address | undefined)
        if (paymaster) {
            this.entityCount[paymaster] =
                (this.entityCount[paymaster] ?? 0n) - 1n

            this.entityCount[paymaster] =
                this.entityCount[paymaster] < 0n
                    ? 0n
                    : this.entityCount[paymaster]
        }

        const factory = (
            isUserOpV06
                ? getAddressFromInitCodeOrPaymasterAndData(
                      userOperation.initCode
                  )
                : userOperation.factory
        ) as Address | undefined
        if (factory) {
            this.entityCount[factory] = (this.entityCount[factory] ?? 0n) - 1n

            this.entityCount[factory] =
                this.entityCount[factory] < 0n ? 0n : this.entityCount[factory]
        }
    }

    checkReputationStatus(
        entryPoint: Address,
        entityType: EntityType,
        stakeInfo: StakeInfo,
        maxMempoolUserOperationsPerSenderOverride?: bigint
    ) {
        const maxTxMempoolAllowedEntity =
            maxMempoolUserOperationsPerSenderOverride ??
            this.calCulateMaxMempoolUserOperationsPerEntity(
                entryPoint,
                stakeInfo.addr as Address
            )

        this.checkBanned(entryPoint, entityType, stakeInfo)

        const entityCount = this.getEntityCount(stakeInfo.addr as Address)

        if (entityCount > this.throttledEntityMinMempoolCount) {
            this.checkThrottled(entryPoint, entityType, stakeInfo)
        }
        if (entityCount > maxTxMempoolAllowedEntity) {
            this.checkStake(entryPoint, entityType, stakeInfo)
        }
    }

    getStatus(entryPoint: Address, address: Address | null): ReputationStatus {
        if (!address || this.whitelist.has(address)) {
            return ReputationStatuses.ok
        }
        if (this.blackList.has(address)) {
            return ReputationStatuses.banned
        }
        const entry = this.entries[entryPoint][address]
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

    checkBanned(
        entryPoint: Address,
        entityType: EntityType,
        stakeInfo: StakeInfo
    ) {
        const status = this.getStatus(entryPoint, stakeInfo.addr as Address)
        if (status === ReputationStatuses.banned) {
            throw new RpcError(
                `${entityType} ${stakeInfo.addr} is banned from using the pimlico`,
                ValidationErrors.Reputation
            )
        }
    }

    checkThrottled(
        entryPoint: Address,
        entityType: EntityType,
        stakeInfo: StakeInfo
    ) {
        const status = this.getStatus(entryPoint, stakeInfo.addr as Address)
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

    checkStake(
        entryPoint: Address,
        entityType: EntityType,
        stakeInfo: StakeInfo
    ) {
        if (this.isWhiteListed(stakeInfo.addr as Address)) {
            return
        }
        this.checkBanned(entryPoint, entityType, stakeInfo)

        if (stakeInfo.stake < this.config.minEntityStake) {
            if (stakeInfo.stake === 0n) {
                throw new RpcError(
                    `${entityType} ${stakeInfo.addr} is unstaked and must stake minimum ${this.config.minEntityStake} to use pimlico`,
                    ValidationErrors.InsufficientStake
                )
            }

            throw new RpcError(
                `${entityType} ${stakeInfo.addr} does not have enough stake to use pimlico`,
                ValidationErrors.InsufficientStake
            )
        }

        if (stakeInfo.unstakeDelaySec < this.config.minEntityUnstakeDelay) {
            throw new RpcError(
                `${entityType} ${stakeInfo.addr} does not have enough unstake delay to use pimlico`,
                ValidationErrors.InsufficientStake
            )
        }
    }

    calCulateMaxMempoolUserOperationsPerEntity(
        entryPoint: Address,
        address: Address
    ): bigint {
        const entry = this.entries[entryPoint][address]
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
