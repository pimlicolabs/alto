import type { EventManager } from "@alto/handlers"
import type { MempoolStore } from "@alto/store"
import {
    type Address,
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
    ValidationErrors,
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
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"
import type { AltoConfig } from "../createConfig"
import { calculateAA95GasFloor } from "../executor/utils"
import type { Monitor } from "./monitoring"
import {
    type InterfaceReputationManager,
    ReputationStatuses
} from "./reputationManager"

export class Mempool {
    private config: AltoConfig
    private metrics: Metrics
    private monitor: Monitor
    private reputationManager: InterfaceReputationManager
    public store: MempoolStore
    private throttledEntityBundleCount: number
    private logger: Logger
    private validator: InterfaceValidator
    private eventManager: EventManager

    constructor({
        config,
        metrics,
        monitor,
        reputationManager,
        validator,
        store,
        eventManager
    }: {
        config: AltoConfig
        metrics: Metrics
        monitor: Monitor
        reputationManager: InterfaceReputationManager
        validator: InterfaceValidator
        store: MempoolStore
        eventManager: EventManager
    }) {
        this.metrics = metrics
        this.store = store
        this.config = config
        this.reputationManager = reputationManager
        this.monitor = monitor
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
        entryPoint,
        transactionHash
    }: {
        userOps: UserOpInfo[]
        entryPoint: Address
        transactionHash: Hex
    }) {
        await Promise.all(
            userOps.map(async (userOpInfo) => {
                const { userOpHash } = userOpInfo
                await this.store.removeProcessing({ entryPoint, userOpHash })
                await this.store.addSubmitted({ entryPoint, userOpInfo })
                await this.monitor.setUserOpStatus(userOpHash, {
                    status: "submitted",
                    transactionHash
                })
            })
        )

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
                await this.store.removeProcessing({ entryPoint, userOpHash })
                await this.store.removeSubmitted({ entryPoint, userOpHash })
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
                await this.store.removeProcessing({ entryPoint, userOpHash })
                await this.store.removeSubmitted({ entryPoint, userOpHash })
                this.eventManager.emitDropped(
                    userOpHash,
                    reason,
                    getAAError(reason)
                )
                await this.monitor.setUserOpStatus(userOpHash, {
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

    async removeProcessingUserOps({
        userOps,
        entryPoint
    }: {
        userOps: UserOpInfo[]
        entryPoint: Address
    }) {
        await Promise.all(
            userOps.map(async ({ userOpHash }) => {
                await this.store.removeProcessing({ entryPoint, userOpHash })
            })
        )
    }

    async removeSubmittedUserOps({
        userOps,
        entryPoint
    }: {
        userOps: UserOpInfo[]
        entryPoint: Address
    }) {
        await Promise.all(
            userOps.map(async ({ userOpHash }) => {
                await this.store.removeSubmitted({ entryPoint, userOpHash })
            })
        )
    }

    // === Methods for dropping mempool entries === //

    async dumpOutstanding(entryPoint: Address): Promise<UserOpInfo[]> {
        return await this.store.dumpOutstanding(entryPoint)
    }

    async dumpProcessing(entryPoint: Address): Promise<UserOpInfo[]> {
        return await this.store.dumpProcessing(entryPoint)
    }

    async dumpSubmittedOps(entryPoint: Address): Promise<UserOpInfo[]> {
        return await this.store.dumpSubmitted(entryPoint)
    }

    // === Methods for entity management === //

    async checkEntityMultipleRoleViolation(
        entryPoint: Address,
        op: UserOperation
    ) {
        if (!this.config.safeMode) {
            return Promise.resolve()
        }

        const knownEntities = await this.getKnownEntities(entryPoint)

        if (
            knownEntities.paymasters.has(op.sender) ||
            knownEntities.factories.has(op.sender)
        ) {
            throw new RpcError(
                `The sender address "${op.sender}" is used as a different entity in another UserOperation currently in mempool`,
                ValidationErrors.OpcodeValidation
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
                ValidationErrors.OpcodeValidation
            )
        }
        if (factory && knownEntities.sender.has(factory)) {
            throw new RpcError(
                `A Factory at ${factory} in this UserOperation is used as a sender entity in another UserOperation currently in mempool.`,
                ValidationErrors.OpcodeValidation
            )
        }
        return Promise.resolve()
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
        const userOpHash = await getUserOpHash({
            userOp,
            entryPointAddress: entryPoint,
            chainId: this.config.chainId,
            publicClient: this.config.publicClient
        })

        // Check if the exact same userOperation is already in the mempool.
        if (await this.store.isInMempool({ userOpHash, entryPoint })) {
            return [false, "Already known"]
        }

        // Check if there is a conflicting userOp already being processed
        const validation = await this.store.validateSubmittedOrProcessing({
            entryPoint,
            userOp
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
                    userOpInfo: conflicting.userOpInfo
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
            userOpInfo: {
                userOp,
                userOpHash,
                referencedContracts,
                addedToMempool: Date.now(),
                submissionAttempts: 0
            }
        })

        await this.monitor.setUserOpStatus(userOpHash, {
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
        stakedEntityCount,
        knownEntities,
        senders,
        storageMap,
        entryPoint
    }: {
        userOpInfo: UserOpInfo
        paymasterDeposit: { [paymaster: string]: bigint }
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
        stakedEntityCount: { [addr: string]: number }
        knownEntities: {
            sender: Set<`0x${string}`>
            paymasters: Set<`0x${string}`>
            factories: Set<`0x${string}`>
        }
        senders: Set<string>
        storageMap: StorageMap
    }> {
        if (!this.config.safeMode) {
            return {
                skip: false,
                paymasterDeposit,
                stakedEntityCount,
                knownEntities,
                senders,
                storageMap
            }
        }

        const { userOp, userOpHash, referencedContracts } = userOpInfo

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
                storageMap
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
                storageMap
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
                storageMap
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
                storageMap
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
            this.store.removeOutstanding({ entryPoint, userOpHash })
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
                storageMap
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
                    storageMap
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
                    storageMap
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
            storageMap
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
                    minOpsPerBundle: 1,
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
        minOpsPerBundle,
        maxBundleCount
    }: {
        maxGasLimit: bigint
        entryPoint: Address
        minOpsPerBundle: number
        maxBundleCount?: number
    }): Promise<UserOperationBundle[]> {
        // Check if there are any operations in the store
        const firstOp = await this.store.peekOutstanding(entryPoint)
        if (!firstOp) {
            return []
        }

        // Get EntryPoint version
        const bundles: UserOperationBundle[] = []
        const seenOps = new Set()
        let breakLoop = false

        // Process operations until no more are available or we hit maxBundleCount
        while (await this.store.peekOutstanding(entryPoint)) {
            // If maxBundles is set and we reached the limit, break
            if (maxBundleCount && bundles.length >= maxBundleCount) {
                break
            }

            // Derive version
            let version: EntryPointVersion
            if (isVersion08(firstOp.userOp, entryPoint)) {
                version = "0.8"
            } else if (isVersion07(firstOp.userOp)) {
                version = "0.7"
            } else {
                version = "0.6"
            }

            // Setup for next bundle
            const currentBundle: UserOperationBundle = {
                entryPoint,
                version,
                userOps: [],
                submissionAttempts: 0
            }
            let gasUsed = 0n
            let paymasterDeposit: { [paymaster: string]: bigint } = {}
            let stakedEntityCount: { [addr: string]: number } = {}
            let senders = new Set<string>()
            let knownEntities = await this.getKnownEntities(entryPoint)
            let storageMap: StorageMap = {}

            if (breakLoop) {
                break
            }

            // Keep adding ops to current bundle
            while (await this.store.peekOutstanding(entryPoint)) {
                const userOpInfo = await this.store.popOutstanding(entryPoint)
                if (!userOpInfo) {
                    break
                }

                if (seenOps.has(userOpInfo.userOpHash)) {
                    breakLoop = true
                    await this.store.addOutstanding({
                        entryPoint,
                        userOpInfo
                    })
                    break
                }

                seenOps.add(userOpInfo.userOpHash)

                const { userOp } = userOpInfo

                // Check if we should skip this operation
                const skipResult = await this.shouldSkip({
                    userOpInfo,
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
                            userOpInfo
                        })
                    }
                    continue
                }

                const beneficiary =
                    this.config.utilityPrivateKey?.address ||
                    privateKeyToAddress(generatePrivateKey())

                gasUsed += calculateAA95GasFloor({
                    userOps: [userOp],
                    beneficiary
                })

                // Only break on gas limit if we've hit minOpsPerBundle
                if (
                    gasUsed > maxGasLimit &&
                    currentBundle.userOps.length >= minOpsPerBundle
                ) {
                    // Put the operation back in the store
                    await this.store.addOutstanding({ entryPoint, userOpInfo })
                    break
                }

                // Update state based on skip result
                paymasterDeposit = skipResult.paymasterDeposit
                stakedEntityCount = skipResult.stakedEntityCount
                knownEntities = skipResult.knownEntities
                senders = skipResult.senders
                storageMap = skipResult.storageMap

                this.reputationManager.decreaseUserOpCount(userOp)
                this.store.addProcessing({ entryPoint, userOpInfo })

                // Add op to current bundle
                currentBundle.userOps.push(userOpInfo)
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
