import type { EventManager } from "@alto/handlers"
import type { MempoolStore } from "@alto/store"
import {
    type Address,
    ERC7769Errors,
    EntryPointV06Abi,
    EntryPointV07Abi,
    type InterfaceValidator,
    type ReferencedCodeHashes,
    type RejectedUserOp,
    RpcError,
    type StorageMap,
    type UserOpInfo,
    type UserOperation,
    type UserOperationBundle,
    type ValidationResult
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import {
    getAAError,
    getAddressFromInitCodeOrPaymasterAndData,
    getUserOpHash,
    isVersion06,
    isVersion07,
    isVersion08,
    jsonStringifyWithBigint,
    scaleBigIntByPercent
} from "@alto/utils"
import { type Hex, getAddress, getContract } from "viem"
import type { EntryPointVersion } from "viem/account-abstraction"
import type { AltoConfig } from "../createConfig"
import { calculateAA95GasFloor } from "../executor/utils"
import { getEip7702AuthAddress } from "../utils/eip7702"
import {
    type InterfaceReputationManager,
    ReputationStatuses
} from "./reputationManager"
import type { StatusManager } from "./statusManager"

export class Mempool {
    private readonly config: AltoConfig
    private readonly metrics: Metrics
    private readonly statusManager: StatusManager
    private readonly reputationManager: InterfaceReputationManager
    private readonly throttledEntityBundleCount: number
    private readonly logger: Logger
    private readonly validator: InterfaceValidator
    private readonly eventManager: EventManager
    public store: MempoolStore

    constructor({
        config,
        metrics,
        statusManager,
        reputationManager,
        validator,
        store,
        eventManager
    }: {
        config: AltoConfig
        metrics: Metrics
        statusManager: StatusManager
        reputationManager: InterfaceReputationManager
        validator: InterfaceValidator
        store: MempoolStore
        eventManager: EventManager
    }) {
        this.metrics = metrics
        this.store = store
        this.config = config
        this.reputationManager = reputationManager
        this.statusManager = statusManager
        this.validator = validator
        this.logger = config.getLogger(
            { module: "mempool" },
            {
                level: config.logLevel
            }
        )
        this.throttledEntityBundleCount = 4 // we don't have any config for this as of now
        this.eventManager = eventManager
    }

    // === Methods for handling changing userOp state === //

    async markUserOpsAsSubmitted({
        userOps,
        transactionHash
    }: {
        userOps: UserOpInfo[]
        transactionHash: Hex
    }) {
        const userOpHashes = userOps.map((userOpInfo) => userOpInfo.userOpHash)

        await this.statusManager.set(userOpHashes, {
            status: "submitted",
            transactionHash
        })

        this.metrics.userOpsSubmitted
            .labels({ status: "success" })
            .inc(userOps.length)
    }

    async resubmitUserOps({
        userOps,
        entryPoint,
        reason
    }: {
        userOps: UserOpInfo[]
        entryPoint: Address
        reason: string
    }) {
        await Promise.all(
            userOps.map(async (userOpInfo) => {
                const { userOpHash, userOp } = userOpInfo
                this.logger.warn(
                    {
                        userOpHash,
                        reason
                    },
                    "resubmitting user operation"
                )
                // Complete processing before re-adding to outstanding pool.
                await this.store.removeProcessing({
                    entryPoint,
                    userOpInfo
                })
                const [success, failureReason] = await this.add(
                    userOp,
                    entryPoint
                )

                if (!success) {
                    this.logger.error(
                        { userOpHash, failureReason },
                        "Failed to resubmit user operation"
                    )
                    const rejectedUserOp = {
                        ...userOpInfo,
                        reason: failureReason
                    }
                    this.dropUserOps(entryPoint, [rejectedUserOp])
                }
            })
        )

        this.metrics.userOpsResubmitted.inc(userOps.length)
    }

    async dropUserOps(entryPoint: Address, rejectedUserOps: RejectedUserOp[]) {
        await Promise.all(
            rejectedUserOps.map(async (rejectedUserOp) => {
                const { userOp, reason, userOpHash } = rejectedUserOp
                // Complete processing since userOp is dropped.
                await this.store.removeProcessing({
                    entryPoint,
                    userOpInfo: rejectedUserOp
                })
                this.eventManager.emitDropped(
                    userOpHash,
                    reason,
                    getAAError(reason)
                )
                await this.statusManager.set([userOpHash], {
                    status: "rejected",
                    transactionHash: null
                })
                this.logger.warn(
                    {
                        userOperation: jsonStringifyWithBigint(userOp),
                        userOpHash,
                        reason
                    },
                    "user operation rejected"
                )
            })
        )
    }

    // Remove userOps from processing store.
    // should be called when userOps are included onchain.
    async removeProcessing({
        userOps,
        entryPoint
    }: {
        userOps: UserOpInfo[]
        entryPoint: Address
    }) {
        await Promise.all(
            userOps.map(async (userOpInfo) => {
                await this.store.removeProcessing({
                    entryPoint,
                    userOpInfo
                })
            })
        )
    }

    // === Methods for dropping mempool entries === //

    async dumpOutstanding(entryPoint: Address): Promise<UserOpInfo[]> {
        return await this.store.dumpOutstanding(entryPoint)
    }

    // === Methods for entity management === //

    async checkEntityMultipleRoleViolation(
        entryPoint: Address,
        op: UserOperation
    ) {
        if (!this.config.safeMode) {
            return
        }

        const knownEntities = await this.getKnownEntities(entryPoint)

        if (
            knownEntities.paymasters.has(op.sender) ||
            knownEntities.factories.has(op.sender)
        ) {
            throw new RpcError(
                `The sender address "${op.sender}" is used as a different entity in another UserOperation currently in mempool`,
                ERC7769Errors.OpcodeValidation
            )
        }

        let paymaster: Address | null = null
        let factory: Address | null = null

        if (isVersion06(op)) {
            paymaster = getAddressFromInitCodeOrPaymasterAndData(
                op.paymasterAndData
            )

            factory = getAddressFromInitCodeOrPaymasterAndData(op.initCode)
        }

        if (isVersion07(op)) {
            paymaster = op.paymaster
            factory = op.factory
        }

        if (paymaster && knownEntities.sender.has(paymaster)) {
            throw new RpcError(
                `A Paymaster at ${paymaster} in this UserOperation is used as a sender entity in another UserOperation currently in mempool.`,
                ERC7769Errors.OpcodeValidation
            )
        }
        if (factory && knownEntities.sender.has(factory)) {
            throw new RpcError(
                `A Factory at ${factory} in this UserOperation is used as a sender entity in another UserOperation currently in mempool.`,
                ERC7769Errors.OpcodeValidation
            )
        }
    }

    async getKnownEntities(entryPoint: Address): Promise<{
        sender: Set<Address>
        paymasters: Set<Address>
        factories: Set<Address>
    }> {
        // TODO: this won't work with redis
        const allOps = await this.store.dumpOutstanding(entryPoint)

        const entities: {
            sender: Set<Address>
            paymasters: Set<Address>
            factories: Set<Address>
        } = {
            sender: new Set(),
            paymasters: new Set(),
            factories: new Set()
        }

        for (const userOpInfo of allOps) {
            const { userOp } = userOpInfo
            entities.sender.add(userOp.sender)

            const isUserOpV06 = isVersion06(userOp)

            const paymaster = isUserOpV06
                ? getAddressFromInitCodeOrPaymasterAndData(
                      userOp.paymasterAndData
                  )
                : userOp.paymaster

            if (paymaster) {
                entities.paymasters.add(paymaster)
            }

            const factory = isUserOpV06
                ? getAddressFromInitCodeOrPaymasterAndData(userOp.initCode)
                : userOp.factory

            if (factory) {
                entities.factories.add(factory)
            }
        }

        return entities
    }

    // === Methods for adding userOps / creating bundles === //

    async add(
        userOp: UserOperation,
        entryPoint: Address,
        referencedContracts?: ReferencedCodeHashes
    ): Promise<[boolean, string]> {
        const userOpHash = getUserOpHash({
            userOp,
            entryPointAddress: entryPoint,
            chainId: this.config.chainId
        })

        // Check if the userOp is already known or conflicts with existing operations
        const validation = await this.store.checkDuplicatesAndConflicts({
            entryPoint,
            userOp,
            userOpHash
        })

        if (!validation.valid) {
            return [false, validation.reason]
        }

        // Check if there is a userOp we can replace
        const conflicting = await this.store.popConflictingOustanding({
            entryPoint,
            userOp
        })

        if (conflicting) {
            const { userOpInfo, reason } = conflicting
            const conflictingUserOp = userOpInfo.userOp

            const hasHigherPriorityFee =
                userOp.maxPriorityFeePerGas >=
                scaleBigIntByPercent(
                    conflictingUserOp.maxPriorityFeePerGas,
                    110n
                )

            const hasHigherMaxFee =
                userOp.maxFeePerGas >=
                scaleBigIntByPercent(conflictingUserOp.maxFeePerGas, 110n)

            const hasHigherFees = hasHigherPriorityFee && hasHigherMaxFee

            if (!hasHigherFees) {
                const message =
                    reason === "conflicting_deployment"
                        ? "AA10 sender already constructed: A conflicting userOperation with initCode for this sender is already in the mempool"
                        : "AA25 invalid account nonce: User operation already present in mempool"

                // Re-add to outstanding as it wasn't replaced
                await this.store.addOutstanding({
                    entryPoint,
                    userOpInfos: [conflicting.userOpInfo]
                })

                return [false, `${message}, bump the gas price by minimum 10%`]
            }

            await this.reputationManager.replaceUserOpSeenStatus(
                conflictingUserOp,
                entryPoint
            )
        }

        await this.reputationManager.increaseUserOpSeenStatus(
            userOp,
            entryPoint
        )

        await this.store.addOutstanding({
            entryPoint,
            userOpInfos: [
                {
                    userOp,
                    userOpHash,
                    referencedContracts,
                    addedToMempool: Date.now(),
                    submissionAttempts: 0
                }
            ]
        })

        await this.statusManager.set([userOpHash], {
            status: "not_submitted",
            transactionHash: null
        })

        this.eventManager.emitAddedToMempool(userOpHash)
        return [true, ""]
    }

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
    async shouldSkip({
        userOpInfo,
        paymasterDeposit,
        touchedEip7702Auth,
        stakedEntityCount,
        knownEntities,
        senders,
        storageMap,
        entryPoint
    }: {
        userOpInfo: UserOpInfo
        paymasterDeposit: { [paymaster: string]: bigint }
        touchedEip7702Auth: Map<Address, Address>
        stakedEntityCount: { [addr: string]: number }
        knownEntities: {
            sender: Set<`0x${string}`>
            paymasters: Set<`0x${string}`>
            factories: Set<`0x${string}`>
        }
        senders: Set<string>
        storageMap: StorageMap
        entryPoint: Address
    }): Promise<{
        skip: boolean
        removeOutstanding?: boolean
        paymasterDeposit: { [paymaster: string]: bigint }
        touchedEip7702Auth: Map<Address, Address>
        stakedEntityCount: { [addr: string]: number }
        knownEntities: {
            sender: Set<`0x${string}`>
            paymasters: Set<`0x${string}`>
            factories: Set<`0x${string}`>
        }
        senders: Set<string>
        storageMap: StorageMap
    }> {
        const { userOp, userOpHash, referencedContracts } = userOpInfo

        // Check conflicting EIP-7702 auths (same sender, different delegate address)
        if (userOp.eip7702Auth) {
            const auth = getEip7702AuthAddress(userOp.eip7702Auth)
            const existingAuth = touchedEip7702Auth.get(userOp.sender)

            if (existingAuth && existingAuth !== auth) {
                this.logger.warn(
                    {
                        userOpHash,
                        conflictingAuth: auth,
                        existingAuth
                    },
                    "Conflicting EIP-7702 auths"
                )

                return {
                    skip: true,
                    removeOutstanding: false,
                    paymasterDeposit,
                    touchedEip7702Auth,
                    stakedEntityCount,
                    knownEntities,
                    senders,
                    storageMap
                }
            }

            if (!existingAuth) {
                touchedEip7702Auth.set(userOp.sender, auth)
            }
        }

        if (!this.config.safeMode) {
            return {
                skip: false,
                paymasterDeposit,
                stakedEntityCount,
                knownEntities,
                senders,
                storageMap,
                touchedEip7702Auth
            }
        }

        const isUserOpV06 = isVersion06(userOp)

        const paymaster = isUserOpV06
            ? getAddressFromInitCodeOrPaymasterAndData(userOp.paymasterAndData)
            : userOp.paymaster
        const factory = isUserOpV06
            ? getAddressFromInitCodeOrPaymasterAndData(userOp.initCode)
            : userOp.factory
        const paymasterStatus = this.reputationManager.getStatus(
            entryPoint,
            paymaster
        )
        const factoryStatus = this.reputationManager.getStatus(
            entryPoint,
            factory
        )

        if (
            paymasterStatus === ReputationStatuses.banned ||
            factoryStatus === ReputationStatuses.banned
        ) {
            return {
                skip: true,
                removeOutstanding: true,
                paymasterDeposit,
                stakedEntityCount,
                knownEntities,
                senders,
                storageMap,
                touchedEip7702Auth
            }
        }

        if (
            paymasterStatus === ReputationStatuses.throttled &&
            paymaster &&
            stakedEntityCount[paymaster] >= this.throttledEntityBundleCount
        ) {
            this.logger.trace(
                {
                    paymaster,
                    userOpHash
                },
                "Throttled paymaster skipped"
            )
            return {
                skip: true,
                paymasterDeposit,
                stakedEntityCount,
                knownEntities,
                senders,
                storageMap,
                touchedEip7702Auth
            }
        }

        if (
            factoryStatus === ReputationStatuses.throttled &&
            factory &&
            stakedEntityCount[factory] >= this.throttledEntityBundleCount
        ) {
            this.logger.trace(
                {
                    factory,
                    userOpHash
                },
                "Throttled factory skipped"
            )
            return {
                skip: true,
                paymasterDeposit,
                stakedEntityCount,
                knownEntities,
                senders,
                storageMap,
                touchedEip7702Auth
            }
        }

        if (
            senders.has(userOp.sender) &&
            this.config.enforceUniqueSendersPerBundle
        ) {
            this.logger.trace(
                {
                    sender: userOp.sender,
                    userOpHash
                },
                "Sender skipped because already included in bundle"
            )
            return {
                skip: true,
                paymasterDeposit,
                stakedEntityCount,
                knownEntities,
                senders,
                storageMap,
                touchedEip7702Auth
            }
        }

        let validationResult: ValidationResult & { storageMap: StorageMap }

        try {
            let queuedUserOps: UserOperation[] = []

            if (!isUserOpV06) {
                queuedUserOps = await this.getQueuedOutstandingUserOps({
                    userOp,
                    entryPoint
                })
            }

            validationResult = await this.validator.validateUserOp({
                userOp,
                queuedUserOps,
                entryPoint,
                referencedContracts
            })
        } catch (e) {
            this.logger.error(
                {
                    userOpHash,
                    error: JSON.stringify(e)
                },
                "2nd Validation error"
            )
            await this.store.removeOutstanding({ entryPoint, userOpHash })
            this.reputationManager.decreaseUserOpSeenStatus(
                userOp,
                entryPoint,
                e instanceof RpcError ? e.message : JSON.stringify(e)
            )
            return {
                skip: true,
                paymasterDeposit,
                stakedEntityCount,
                knownEntities,
                senders,
                storageMap,
                touchedEip7702Auth
            }
        }

        for (const storageAddress of Object.keys(validationResult.storageMap)) {
            const address = getAddress(storageAddress)

            if (
                address !== userOp.sender &&
                knownEntities.sender.has(address)
            ) {
                this.logger.trace(
                    {
                        storageAddress,
                        userOpHash
                    },
                    "Storage address skipped"
                )
                return {
                    skip: true,
                    paymasterDeposit,
                    stakedEntityCount,
                    knownEntities,
                    senders,
                    storageMap,
                    touchedEip7702Auth
                }
            }
        }

        if (paymaster) {
            if (paymasterDeposit[paymaster] === undefined) {
                const entryPointContract = getContract({
                    abi: isUserOpV06 ? EntryPointV06Abi : EntryPointV07Abi,
                    address: entryPoint,
                    client: {
                        public: this.config.publicClient
                    }
                })
                paymasterDeposit[paymaster] =
                    await entryPointContract.read.balanceOf([paymaster])
            }
            if (
                paymasterDeposit[paymaster] <
                validationResult.returnInfo.prefund
            ) {
                this.logger.trace(
                    {
                        paymaster,
                        userOpHash
                    },
                    "Paymaster skipped because of insufficient balance left to sponsor all user ops in the bundle"
                )
                return {
                    skip: true,
                    paymasterDeposit,
                    stakedEntityCount,
                    knownEntities,
                    senders,
                    storageMap,
                    touchedEip7702Auth
                }
            }
            stakedEntityCount[paymaster] =
                (stakedEntityCount[paymaster] ?? 0) + 1
            paymasterDeposit[paymaster] -= validationResult.returnInfo.prefund
        }

        if (factory) {
            stakedEntityCount[factory] = (stakedEntityCount[factory] ?? 0) + 1
        }

        senders.add(userOp.sender)

        return {
            skip: false,
            paymasterDeposit,
            stakedEntityCount,
            knownEntities,
            senders,
            storageMap,
            touchedEip7702Auth
        }
    }

    public async getBundles(
        maxBundleCount?: number
    ): Promise<UserOperationBundle[]> {
        const bundlePromises = this.config.entrypoints.map(
            async (entryPoint) => {
                return await this.process({
                    entryPoint,
                    maxGasLimit: this.config.maxGasPerBundle,
                    maxBundleCount
                })
            }
        )

        const bundlesNested = await Promise.all(bundlePromises)
        const bundles = bundlesNested.flat()

        return bundles
    }

    // Returns a bundle of userOperations in array format.
    async process({
        maxGasLimit,
        entryPoint,
        maxBundleCount
    }: {
        maxGasLimit: bigint
        entryPoint: Address
        maxBundleCount?: number
    }): Promise<UserOperationBundle[]> {
        const bundles: UserOperationBundle[] = []
        const batchSize = this.config.mempoolPopBatchSize

        // Pop batch of userOps.
        const poppedUserOps = await this.store.popOutstanding(
            entryPoint,
            batchSize
        )
        if (poppedUserOps.length === 0) {
            return []
        }

        // Keep track of unused ops from the batch
        const unusedUserOps = [...poppedUserOps]

        while (unusedUserOps.length > 0) {
            // If maxBundles is set and we reached the limit, put back all unused ops and break.
            if (maxBundleCount && bundles.length >= maxBundleCount) {
                if (unusedUserOps.length > 0) {
                    await this.store.addOutstanding({
                        entryPoint,
                        userOpInfos: unusedUserOps
                    })
                }
                break
            }

            // Peek next userOp from unused batch.
            const nextUserOp = unusedUserOps[0]
            if (!nextUserOp) break

            // Derive version.
            let version: EntryPointVersion
            if (isVersion08(nextUserOp.userOp, entryPoint)) {
                version = "0.8"
            } else if (isVersion07(nextUserOp.userOp)) {
                version = "0.7"
            } else {
                version = "0.6"
            }

            // Setup next bundle.
            const currentBundle: UserOperationBundle = {
                entryPoint,
                version,
                userOps: [],
                submissionAttempts: 0
            }
            let gasUsed = 0n
            let touchedEip7702Auth = new Map<Address, Address>()
            let paymasterDeposit: { [paymaster: string]: bigint } = {}
            let stakedEntityCount: { [addr: string]: number } = {}
            let senders = new Set<string>()
            let knownEntities = await this.getKnownEntities(entryPoint)
            let storageMap: StorageMap = {}

            while (unusedUserOps.length > 0) {
                const currentUserOp = unusedUserOps.shift()
                if (!currentUserOp) break
                const { userOp } = currentUserOp

                // Check if we should skip this operation
                const skipResult = await this.shouldSkip({
                    userOpInfo: currentUserOp,
                    touchedEip7702Auth,
                    paymasterDeposit,
                    stakedEntityCount,
                    knownEntities,
                    senders,
                    storageMap,
                    entryPoint
                })

                if (skipResult.skip) {
                    // Re-add to outstanding
                    if (!skipResult.removeOutstanding) {
                        await this.store.addOutstanding({
                            entryPoint,
                            userOpInfos: [currentUserOp]
                        })
                    }
                    // Continue with next op from batch
                    continue
                }

                gasUsed += calculateAA95GasFloor({
                    userOps: [userOp],
                    beneficiary: this.config.utilityWalletAddress
                })

                // Break on gas limit
                if (gasUsed > maxGasLimit) {
                    // Put current op back to front of unused for next bundle
                    unusedUserOps.unshift(currentUserOp)
                    break
                }

                // Update state based on skip result
                paymasterDeposit = skipResult.paymasterDeposit
                stakedEntityCount = skipResult.stakedEntityCount
                knownEntities = skipResult.knownEntities
                senders = skipResult.senders
                storageMap = skipResult.storageMap
                touchedEip7702Auth = skipResult.touchedEip7702Auth

                this.reputationManager.decreaseUserOpCount(userOp)
                // Track the operation as active (being bundled).
                await this.store.addProcessing({
                    entryPoint,
                    userOpInfo: currentUserOp
                })

                // Add userOp to current bundle.
                currentBundle.userOps.push(currentUserOp)

                // Try to fetch more userOps if we've exhausted this batch.
                if (unusedUserOps.length === 0) {
                    const morePoppedOps = await this.store.popOutstanding(
                        entryPoint,
                        batchSize
                    )
                    unusedUserOps.push(...morePoppedOps)
                }
            }

            if (currentBundle.userOps.length > 0) {
                bundles.push(currentBundle)
            }
        }

        return bundles
    }

    clear(): void {
        for (const entryPoint of this.config.entrypoints) {
            this.store.clearOutstanding(entryPoint)
        }
    }

    public async getQueuedOutstandingUserOps(args: {
        userOp: UserOperation
        entryPoint: Address
    }) {
        return await this.store.getQueuedOutstandingUserOps(args)
    }
}
