import type { EventManager } from "@alto/handlers"
// import { MongoClient, Collection, Filter } from "mongodb"
// import { PublicClient, getContract } from "viem"
// import { EntryPointAbi } from "../types/EntryPoint"
import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    type InterfaceValidator,
    type ReferencedCodeHashes,
    RpcError,
    type StorageMap,
    type SubmittedUserOperation,
    type TransactionInfo,
    type UserOperation,
    type UserOperationInfo,
    ValidationErrors,
    type ValidationResult,
    UserOperationBundle
} from "@alto/types"
import type { Metrics } from "@alto/utils"
import type { Logger } from "@alto/utils"
import {
    getAddressFromInitCodeOrPaymasterAndData,
    getNonceKeyAndValue,
    getUserOperationHash,
    isVersion06,
    isVersion07
} from "@alto/utils"
import { type Address, getAddress, getContract } from "viem"
import type { Monitor } from "./monitoring"
import {
    type InterfaceReputationManager,
    ReputationStatuses
} from "./reputationManager"
import { MemoryStore } from "./store"
import type { AltoConfig } from "../createConfig"

export class MemoryMempool {
    private config: AltoConfig
    private monitor: Monitor
    private reputationManager: InterfaceReputationManager
    private store: MemoryStore
    private throttledEntityBundleCount: number
    private logger: Logger
    private validator: InterfaceValidator
    private eventManager: EventManager

    constructor({
        config,
        monitor,
        reputationManager,
        validator,
        metrics,
        eventManager
    }: {
        config: AltoConfig
        monitor: Monitor
        reputationManager: InterfaceReputationManager
        validator: InterfaceValidator
        metrics: Metrics
        eventManager: EventManager
    }) {
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
        this.store = new MemoryStore(this.logger, metrics)
        this.throttledEntityBundleCount = 4 // we don't have any config for this as of now
        this.eventManager = eventManager
    }

    replaceSubmitted(
        userOperation: UserOperationInfo,
        transactionInfo: TransactionInfo
    ): void {
        const op = this.store
            .dumpSubmitted()
            .find((op) => op.userOperation.hash === userOperation.hash)
        if (op) {
            this.store.removeSubmitted(userOperation.hash)
            this.store.addSubmitted({
                userOperation,
                transactionInfo
            })
            this.monitor.setUserOperationStatus(userOperation.hash, {
                status: "submitted",
                transactionHash: transactionInfo.transactionHash
            })
        }
    }

    markSubmitted(
        userOpHash: `0x${string}`,
        transactionInfo: TransactionInfo
    ): void {
        const op = this.store
            .dumpProcessing()
            .find((op) => op.hash === userOpHash)
        if (op) {
            this.store.removeProcessing(userOpHash)
            this.store.addSubmitted({
                userOperation: op,
                transactionInfo
            })
            this.monitor.setUserOperationStatus(userOpHash, {
                status: "submitted",
                transactionHash: transactionInfo.transactionHash
            })
        }
    }

    dumpOutstanding(): UserOperation[] {
        return this.store.dumpOutstanding()
    }

    dumpProcessing(): UserOperationInfo[] {
        return this.store.dumpProcessing()
    }

    dumpSubmittedOps(): SubmittedUserOperation[] {
        return this.store.dumpSubmitted()
    }

    removeSubmitted(userOpHash: `0x${string}`): void {
        this.store.removeSubmitted(userOpHash)
    }

    removeProcessing(userOpHash: `0x${string}`): void {
        this.store.removeProcessing(userOpHash)
    }

    checkEntityMultipleRoleViolation(op: UserOperation): Promise<void> {
        if (!this.config.safeMode) {
            return Promise.resolve()
        }

        const knownEntities = this.getKnownEntities()

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

    getKnownEntities(): {
        sender: Set<Address>
        paymasters: Set<Address>
        factories: Set<Address>
    } {
        const allOps = [...this.store.dumpOutstanding()]

        const entities: {
            sender: Set<Address>
            paymasters: Set<Address>
            factories: Set<Address>
        } = {
            sender: new Set(),
            paymasters: new Set(),
            factories: new Set()
        }

        for (const op of allOps) {
            entities.sender.add(op.sender)

            const isUserOpV06 = isVersion06(op)

            const paymaster = isUserOpV06
                ? getAddressFromInitCodeOrPaymasterAndData(op.paymasterAndData)
                : op.paymaster

            if (paymaster) {
                entities.paymasters.add(paymaster)
            }

            const factory = isUserOpV06
                ? getAddressFromInitCodeOrPaymasterAndData(op.initCode)
                : op.factory

            if (factory) {
                entities.factories.add(factory)
            }
        }

        return entities
    }

    // TODO: add check for adding a userop with conflicting nonce
    // In case of concurrent requests
    add(
        userOperation: UserOperation,
        entryPoint: Address,
        referencedContracts?: ReferencedCodeHashes
    ): [boolean, string] {
        const opHash = getUserOperationHash(
            userOperation,
            entryPoint,
            this.config.publicClient.chain.id
        )

        const outstandingOps = [...this.store.dumpOutstanding()]

        const processedOrSubmittedOps = [
            ...this.store.dumpProcessing(),
            ...this.store
                .dumpSubmitted()
                .map(({ userOperation }) => userOperation)
        ]

        // Check if the exact same userOperation is already in the mempool.
        const existingUserOperation = [
            ...outstandingOps,
            ...processedOrSubmittedOps
        ].find((userOperation) => userOperation.hash === opHash)

        if (existingUserOperation) {
            return [false, "Already known"]
        }

        if (
            processedOrSubmittedOps.find((mempoolUserOp) => {
                return (
                    mempoolUserOp.sender === userOperation.sender &&
                    mempoolUserOp.nonce === userOperation.nonce
                )
            })
        ) {
            return [
                false,
                "AA25 invalid account nonce: User operation is already in mempool and getting processed with same nonce and sender"
            ]
        }

        this.reputationManager.updateUserOperationSeenStatus(
            userOperation,
            entryPoint
        )
        const oldUserOp = [...outstandingOps, ...processedOrSubmittedOps].find(
            (mempoolUserOp) => {
                const isSameSender =
                    mempoolUserOp.sender === userOperation.sender

                if (
                    isSameSender &&
                    mempoolUserOp.nonce === userOperation.nonce
                ) {
                    return true
                }

                // Check if there is already a userOperation with initCode + same sender (stops rejected ops due to AA10).
                if (
                    isVersion06(mempoolUserOp) &&
                    isVersion06(userOperation) &&
                    userOperation.initCode &&
                    userOperation.initCode !== "0x"
                ) {
                    return (
                        isSameSender &&
                        mempoolUserOp.initCode &&
                        mempoolUserOp.initCode !== "0x"
                    )
                }

                // Check if there is already a userOperation with factory + same sender (stops rejected ops due to AA10).
                if (
                    isVersion07(mempoolUserOp) &&
                    isVersion07(userOperation) &&
                    userOperation.factory &&
                    userOperation.factory !== "0x"
                ) {
                    return (
                        isSameSender &&
                        mempoolUserOp.factory &&
                        mempoolUserOp.factory !== "0x"
                    )
                }

                return false
            }
        )

        const isOldUserOpProcessingOrSubmitted = processedOrSubmittedOps.some(
            (submittedOp) => submittedOp.hash === oldUserOp?.hash
        )

        if (oldUserOp) {
            let reason =
                "AA10 sender already constructed: A conflicting userOperation with initCode for this sender is already in the mempool. bump the gas price by minimum 10%"

            if (oldUserOp.nonce === userOperation.nonce) {
                reason =
                    "AA25 invalid account nonce: User operation already present in mempool, bump the gas price by minimum 10%"
            }

            // if oldOp is already in processing or submitted mempool, we can't replace it so early exit.
            if (isOldUserOpProcessingOrSubmitted) {
                return [false, reason]
            }

            const oldMaxPriorityFeePerGas = oldUserOp.maxPriorityFeePerGas
            const newMaxPriorityFeePerGas = userOperation.maxPriorityFeePerGas
            const oldMaxFeePerGas = oldUserOp.maxFeePerGas
            const newMaxFeePerGas = userOperation.maxFeePerGas

            const incrementMaxPriorityFeePerGas =
                (oldMaxPriorityFeePerGas * BigInt(10)) / BigInt(100)
            const incrementMaxFeePerGas =
                (oldMaxFeePerGas * BigInt(10)) / BigInt(100)

            if (
                newMaxPriorityFeePerGas <
                    oldMaxPriorityFeePerGas + incrementMaxPriorityFeePerGas ||
                newMaxFeePerGas < oldMaxFeePerGas + incrementMaxFeePerGas
            ) {
                return [false, reason]
            }

            this.store.removeOutstanding(oldUserOp.hash)
        }

        // Check if mempool already includes max amount of parallel user operations
        const parallelUserOperationsCount = this.store
            .dumpOutstanding()
            .filter((userOp) => {
                return userOp.sender === userOperation.sender
            }).length

        if (parallelUserOperationsCount > this.config.mempoolMaxParallelOps) {
            return [
                false,
                "AA25 invalid account nonce: Maximum number of parallel user operations for that is allowed for this sender reached"
            ]
        }

        // Check if mempool already includes max amount of queued user operations
        const [nonceKey] = getNonceKeyAndValue(userOperation.nonce)
        const queuedUserOperationsCount = this.store
            .dumpOutstanding()
            .filter((userOp) => {
                const [opNonceKey] = getNonceKeyAndValue(userOp.nonce)

                return (
                    userOp.sender === userOperation.sender &&
                    opNonceKey === nonceKey
                )
            }).length

        if (queuedUserOperationsCount > this.config.mempoolMaxQueuedOps) {
            return [
                false,
                "AA25 invalid account nonce: Maximum number of queued user operations reached for this sender and nonce key"
            ]
        }

        this.store.addOutstanding({
            ...userOperation,
            entryPoint,
            hash: opHash,
            referencedContracts
        })
        this.monitor.setUserOperationStatus(opHash, {
            status: "not_submitted",
            transactionHash: null
        })

        this.eventManager.emitAddedToMempool(opHash)
        return [true, ""]
    }

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
    async shouldSkip(
        userOperation: UserOperationInfo,
        paymasterDeposit: { [paymaster: string]: bigint },
        stakedEntityCount: { [addr: string]: number },
        knownEntities: {
            sender: Set<`0x${string}`>
            paymasters: Set<`0x${string}`>
            factories: Set<`0x${string}`>
        },
        senders: Set<string>,
        storageMap: StorageMap
    ): Promise<{
        skip: boolean
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

        const isUserOpV06 = isVersion06(userOperation)

        const paymaster = isUserOpV06
            ? getAddressFromInitCodeOrPaymasterAndData(
                  userOperation.paymasterAndData
              )
            : userOperation.paymaster
        const factory = isUserOpV06
            ? getAddressFromInitCodeOrPaymasterAndData(userOperation.initCode)
            : userOperation.factory
        const paymasterStatus = this.reputationManager.getStatus(
            userOperation.entryPoint,
            paymaster
        )
        const factoryStatus = this.reputationManager.getStatus(
            userOperation.entryPoint,
            factory
        )

        if (
            paymasterStatus === ReputationStatuses.banned ||
            factoryStatus === ReputationStatuses.banned
        ) {
            this.store.removeOutstanding(userOperation.hash)
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
            paymasterStatus === ReputationStatuses.throttled &&
            paymaster &&
            stakedEntityCount[paymaster] >= this.throttledEntityBundleCount
        ) {
            this.logger.trace(
                {
                    paymaster,
                    opHash: userOperation.hash
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
                    opHash: userOperation.hash
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
            senders.has(userOperation.sender) &&
            this.config.enforceUniqueSendersPerBundle
        ) {
            this.logger.trace(
                {
                    sender: userOperation.sender,
                    opHash: userOperation.hash
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
            let queuedUserOperations: UserOperation[] = []

            if (!isUserOpV06) {
                queuedUserOperations = await this.getQueuedUserOperations(
                    userOperation,
                    userOperation.entryPoint
                )
            }

            validationResult = await this.validator.validateUserOperation({
                shouldCheckPrefund: false,
                userOperation: userOperation,
                queuedUserOperations,
                entryPoint: userOperation.entryPoint,
                referencedContracts: userOperation.referencedContracts
            })
        } catch (e) {
            this.logger.error(
                {
                    opHash: userOperation.hash,
                    error: JSON.stringify(e)
                },
                "2nd Validation error"
            )
            this.store.removeOutstanding(userOperation.hash)
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
                address !== userOperation.sender &&
                knownEntities.sender.has(address)
            ) {
                this.logger.trace(
                    {
                        storageAddress,
                        opHash: userOperation.hash
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
                    address: userOperation.entryPoint,
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
                        opHash: userOperation.hash
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

        senders.add(userOperation.sender)

        return {
            skip: false,
            paymasterDeposit,
            stakedEntityCount,
            knownEntities,
            senders,
            storageMap
        }
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
        let outstandingUserOperations = this.store
            .dumpOutstanding()
            .filter((op) => op.entryPoint === entryPoint)
            .sort((aUserOp, bUserOp) => {
                // Sort userops before the execution
                // Decide the order of the userops based on the sender and nonce
                // If sender is the same, sort by nonce key
                if (aUserOp.sender === bUserOp.sender) {
                    const [aNonceKey, aNonceValue] = getNonceKeyAndValue(
                        aUserOp.nonce
                    )
                    const [bNonceKey, bNonceValue] = getNonceKeyAndValue(
                        bUserOp.nonce
                    )

                    if (aNonceKey === bNonceKey) {
                        return Number(aNonceValue - bNonceValue)
                    }

                    return Number(aNonceKey - bNonceKey)
                }

                return 0
            })
            .slice()

        // Get EntryPoint version. (Ideally version should be derived from CLI flags)
        const isV6 = isVersion06(outstandingUserOperations[0])
        const allSameVersion = outstandingUserOperations.every(
            (userOperation) => isVersion06(userOperation) === isV6
        )
        if (!allSameVersion) {
            throw new Error(
                "All user operations from same EntryPoint must be of the same version"
            )
        }

        const bundles: UserOperationBundle[] = []

        // Process all outstanding ops.
        while (outstandingUserOperations.length > 0) {
            // If maxBundles is set and we reached the limit, break.
            if (maxBundleCount && bundles.length >= maxBundleCount) {
                break
            }

            // Setup for next bundle.
            const currentBundle: UserOperationBundle = {
                entryPoint,
                version: isV6 ? "0.6" : "0.7",
                userOperations: []
            }
            let gasUsed = 0n

            let paymasterDeposit: { [paymaster: string]: bigint } = {} // paymaster deposit should be enough for all UserOps in the bundle.
            let stakedEntityCount: { [addr: string]: number } = {} // throttled paymasters and factories are allowed only small UserOps per bundle.
            let senders = new Set<string>() // each sender is allowed only once per bundle
            let knownEntities = this.getKnownEntities()
            let storageMap: StorageMap = {}

            // Keep adding ops to current bundle.
            while (outstandingUserOperations.length > 0) {
                const userOperation = outstandingUserOperations.shift()
                if (!userOperation) break

                const skipResult = await this.shouldSkip(
                    userOperation,
                    paymasterDeposit,
                    stakedEntityCount,
                    knownEntities,
                    senders,
                    storageMap
                )
                if (skipResult.skip) continue

                gasUsed +=
                    userOperation.callGasLimit +
                    userOperation.verificationGasLimit +
                    (isVersion07(userOperation)
                        ? (userOperation.paymasterPostOpGasLimit || 0n) +
                          (userOperation.paymasterVerificationGasLimit || 0n)
                        : 0n)

                // Only break on gas limit if we've hit minOpsPerBundle.
                if (
                    gasUsed > maxGasLimit &&
                    currentBundle.userOperations.length >= minOpsPerBundle
                ) {
                    outstandingUserOperations.unshift(userOperation) // re-add op to front of queue
                    break
                }

                // Update state based on skip result
                paymasterDeposit = skipResult.paymasterDeposit
                stakedEntityCount = skipResult.stakedEntityCount
                knownEntities = skipResult.knownEntities
                senders = skipResult.senders
                storageMap = skipResult.storageMap

                this.reputationManager.decreaseUserOperationCount(userOperation)
                this.store.removeOutstanding(userOperation.hash)
                this.store.addProcessing(userOperation)

                // Add op to current bundle
                currentBundle.userOperations.push(userOperation)
            }

            if (currentBundle.userOperations.length > 0) {
                bundles.push(currentBundle)
            }
        }

        return bundles
    }

    // For a specfic user operation, get all the queued user operations
    // They should be executed first, ordered by nonce value
    // If cuurentNonceValue is not provided, it will be fetched from the chain
    async getQueuedUserOperations(
        userOperation: UserOperation,
        entryPoint: Address,
        _currentNonceValue?: bigint
    ): Promise<UserOperation[]> {
        const entryPointContract = getContract({
            address: entryPoint,
            abi: isVersion06(userOperation)
                ? EntryPointV06Abi
                : EntryPointV07Abi,
            client: {
                public: this.config.publicClient
            }
        })

        const [nonceKey, userOperationNonceValue] = getNonceKeyAndValue(
            userOperation.nonce
        )

        let currentNonceValue: bigint = BigInt(0)

        if (_currentNonceValue) {
            currentNonceValue = _currentNonceValue
        } else {
            const getNonceResult = await entryPointContract.read.getNonce(
                [userOperation.sender, nonceKey],
                {
                    blockTag: "latest"
                }
            )

            currentNonceValue = getNonceKeyAndValue(getNonceResult)[1]
        }

        const outstanding = this.store
            .dumpOutstanding()
            .filter((mempoolUserOp) => {
                const [opNonceKey, opNonceValue] = getNonceKeyAndValue(
                    mempoolUserOp.nonce
                )

                return (
                    mempoolUserOp.sender === userOperation.sender &&
                    opNonceKey === nonceKey &&
                    opNonceValue >= currentNonceValue &&
                    opNonceValue < userOperationNonceValue
                )
            })

        outstanding.sort((a, b) => {
            const [, aNonceValue] = getNonceKeyAndValue(a.nonce)
            const [, bNonceValue] = getNonceKeyAndValue(b.nonce)

            return Number(aNonceValue - bNonceValue)
        })

        return outstanding
    }

    clear(): void {
        this.store.clear("outstanding")
    }
}
