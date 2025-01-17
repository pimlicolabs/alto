import type { EventManager } from "@alto/handlers"
// import { MongoClient, Collection, Filter } from "mongodb"
// import { PublicClient, getContract } from "viem"
// import { EntryPointAbi } from "../types/EntryPoint"
import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    type InterfaceValidator,
    type MempoolUserOperation,
    type ReferencedCodeHashes,
    RpcError,
    type StorageMap,
    type SubmittedUserOperation,
    type TransactionInfo,
    type UserOperation,
    type UserOperationInfo,
    ValidationErrors,
    type ValidationResult,
    deriveUserOperation
} from "@alto/types"
import type { HexData32 } from "@alto/types"
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
            .find(
                (op) =>
                    op.userOperation.userOperationHash ===
                    userOperation.userOperationHash
            )
        if (op) {
            this.store.removeSubmitted(userOperation.userOperationHash)
            this.store.addSubmitted({
                userOperation,
                transactionInfo
            })
            this.monitor.setUserOperationStatus(
                userOperation.userOperationHash,
                {
                    status: "submitted",
                    transactionHash: transactionInfo.transactionHash
                }
            )
        }
    }

    markSubmitted(
        userOpHash: `0x${string}`,
        transactionInfo: TransactionInfo
    ): void {
        const op = this.store
            .dumpProcessing()
            .find((op) => op.userOperationHash === userOpHash)
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

    dumpOutstanding(): UserOperationInfo[] {
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

        for (const mempoolOp of allOps) {
            const op = deriveUserOperation(mempoolOp.mempoolUserOperation)
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
        mempoolUserOperation: MempoolUserOperation,
        entryPoint: Address,
        referencedContracts?: ReferencedCodeHashes
    ): [boolean, string] {
        const op = deriveUserOperation(mempoolUserOperation)
        const opHash = getUserOperationHash(
            op,
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
        ].find(({ userOperationHash }) => userOperationHash === opHash)

        if (existingUserOperation) {
            return [false, "Already known"]
        }

        if (
            processedOrSubmittedOps.find(({ mempoolUserOperation }) => {
                const userOperation = deriveUserOperation(mempoolUserOperation)
                return (
                    userOperation.sender === op.sender &&
                    userOperation.nonce === op.nonce
                )
            })
        ) {
            return [
                false,
                "AA25 invalid account nonce: User operation is already in mempool and getting processed with same nonce and sender"
            ]
        }

        this.reputationManager.updateUserOperationSeenStatus(op, entryPoint)
        const oldUserOp = [...outstandingOps, ...processedOrSubmittedOps].find(
            ({ mempoolUserOperation }) => {
                const userOperation = deriveUserOperation(mempoolUserOperation)

                const isSameSender = userOperation.sender === op.sender

                if (isSameSender && userOperation.nonce === op.nonce) {
                    return true
                }

                // Check if there is already a userOperation with initCode + same sender (stops rejected ops due to AA10).
                if (
                    isVersion06(userOperation) &&
                    isVersion06(op) &&
                    op.initCode &&
                    op.initCode !== "0x"
                ) {
                    return (
                        isSameSender &&
                        userOperation.initCode &&
                        userOperation.initCode !== "0x"
                    )
                }

                // Check if there is already a userOperation with factory + same sender (stops rejected ops due to AA10).
                if (
                    isVersion07(userOperation) &&
                    isVersion07(op) &&
                    op.factory &&
                    op.factory !== "0x"
                ) {
                    return (
                        isSameSender &&
                        userOperation.factory &&
                        userOperation.factory !== "0x"
                    )
                }

                return false
            }
        )

        const isOldUserOpProcessingOrSubmitted = processedOrSubmittedOps.some(
            (op) => op.userOperationHash === oldUserOp?.userOperationHash
        )

        if (oldUserOp) {
            const oldOp = deriveUserOperation(oldUserOp.mempoolUserOperation)

            let reason =
                "AA10 sender already constructed: A conflicting userOperation with initCode for this sender is already in the mempool. bump the gas price by minimum 10%"

            if (oldOp.nonce === op.nonce) {
                reason =
                    "AA25 invalid account nonce: User operation already present in mempool, bump the gas price by minimum 10%"
            }

            // if oldOp is already in processing or submitted mempool, we can't replace it so early exit.
            if (isOldUserOpProcessingOrSubmitted) {
                return [false, reason]
            }

            const oldMaxPriorityFeePerGas = oldOp.maxPriorityFeePerGas
            const newMaxPriorityFeePerGas = op.maxPriorityFeePerGas
            const oldMaxFeePerGas = oldOp.maxFeePerGas
            const newMaxFeePerGas = op.maxFeePerGas

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

            this.store.removeOutstanding(oldUserOp.userOperationHash)
        }

        // Check if mempool already includes max amount of parallel user operations
        const parallelUserOperationsCount = this.store
            .dumpOutstanding()
            .filter((userOpInfo) => {
                const userOp = deriveUserOperation(
                    userOpInfo.mempoolUserOperation
                )
                return userOp.sender === op.sender
            }).length

        if (parallelUserOperationsCount > this.config.mempoolMaxParallelOps) {
            return [
                false,
                "AA25 invalid account nonce: Maximum number of parallel user operations for that is allowed for this sender reached"
            ]
        }

        // Check if mempool already includes max amount of queued user operations
        const [nonceKey] = getNonceKeyAndValue(op.nonce)
        const queuedUserOperationsCount = this.store
            .dumpOutstanding()
            .filter((userOpInfo) => {
                const userOp = deriveUserOperation(
                    userOpInfo.mempoolUserOperation
                )
                const [opNonceKey] = getNonceKeyAndValue(userOp.nonce)

                return userOp.sender === op.sender && opNonceKey === nonceKey
            }).length

        if (queuedUserOperationsCount > this.config.mempoolMaxQueuedOps) {
            return [
                false,
                "AA25 invalid account nonce: Maximum number of queued user operations reached for this sender and nonce key"
            ]
        }

        this.store.addOutstanding({
            mempoolUserOperation,
            entryPoint: entryPoint,
            userOperationHash: opHash,
            firstSubmitted: oldUserOp ? oldUserOp.firstSubmitted : Date.now(),
            lastReplaced: Date.now(),
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
        opInfo: UserOperationInfo,
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
        const op = deriveUserOperation(opInfo.mempoolUserOperation)
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

        const isUserOpV06 = isVersion06(op)

        const paymaster = isUserOpV06
            ? getAddressFromInitCodeOrPaymasterAndData(op.paymasterAndData)
            : op.paymaster
        const factory = isUserOpV06
            ? getAddressFromInitCodeOrPaymasterAndData(op.initCode)
            : op.factory
        const paymasterStatus = this.reputationManager.getStatus(
            opInfo.entryPoint,
            paymaster
        )
        const factoryStatus = this.reputationManager.getStatus(
            opInfo.entryPoint,
            factory
        )

        if (
            paymasterStatus === ReputationStatuses.banned ||
            factoryStatus === ReputationStatuses.banned
        ) {
            this.store.removeOutstanding(opInfo.userOperationHash)
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
                    opHash: opInfo.userOperationHash
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
                    opHash: opInfo.userOperationHash
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
            senders.has(op.sender) &&
            this.config.enforceUniqueSendersPerBundle
        ) {
            this.logger.trace(
                {
                    sender: op.sender,
                    opHash: opInfo.userOperationHash
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
                    op,
                    opInfo.entryPoint
                )
            }

            validationResult = await this.validator.validateUserOperation({
                shouldCheckPrefund: false,
                userOperation: op,
                queuedUserOperations,
                entryPoint: opInfo.entryPoint,
                referencedContracts: opInfo.referencedContracts
            })
        } catch (e) {
            this.logger.error(
                {
                    opHash: opInfo.userOperationHash,
                    error: JSON.stringify(e)
                },
                "2nd Validation error"
            )
            this.store.removeOutstanding(opInfo.userOperationHash)
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

            if (address !== op.sender && knownEntities.sender.has(address)) {
                this.logger.trace(
                    {
                        storageAddress,
                        opHash: opInfo.userOperationHash
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
                    address: opInfo.entryPoint,
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
                        opHash: opInfo.userOperationHash
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

        senders.add(op.sender)

        return {
            skip: false,
            paymasterDeposit,
            stakedEntityCount,
            knownEntities,
            senders,
            storageMap
        }
    }

    async process(
        maxGasLimit: bigint,
        minOps?: number
    ): Promise<UserOperationInfo[]> {
        const outstandingUserOperations = this.store.dumpOutstanding().slice()

        // Sort userops before the execution
        // Decide the order of the userops based on the sender and nonce
        // If sender is the same, sort by nonce key
        outstandingUserOperations.sort((a, b) => {
            const aUserOp = deriveUserOperation(a.mempoolUserOperation)
            const bUserOp = deriveUserOperation(b.mempoolUserOperation)

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

        let opsTaken = 0
        let gasUsed = 0n
        const result: UserOperationInfo[] = []

        // paymaster deposit should be enough for all UserOps in the bundle.
        let paymasterDeposit: { [paymaster: string]: bigint } = {}
        // throttled paymasters and factories are allowed only small UserOps per bundle.
        let stakedEntityCount: { [addr: string]: number } = {}
        // each sender is allowed only once per bundle
        let senders = new Set<string>()
        let knownEntities = this.getKnownEntities()

        let storageMap: StorageMap = {}

        for (const opInfo of outstandingUserOperations) {
            const op = deriveUserOperation(opInfo.mempoolUserOperation)
            gasUsed += op.callGasLimit + op.verificationGasLimit

            if (isVersion07(op)) {
                gasUsed +=
                    (op.paymasterPostOpGasLimit ?? 0n) +
                    (op.paymasterVerificationGasLimit ?? 0n)
            }

            if (gasUsed > maxGasLimit && opsTaken >= (minOps || 0)) {
                break
            }
            const skipResult = await this.shouldSkip(
                opInfo,
                paymasterDeposit,
                stakedEntityCount,
                knownEntities,
                senders,
                storageMap
            )
            paymasterDeposit = skipResult.paymasterDeposit
            stakedEntityCount = skipResult.stakedEntityCount
            knownEntities = skipResult.knownEntities
            senders = skipResult.senders
            storageMap = skipResult.storageMap

            if (skipResult.skip) {
                continue
            }

            this.reputationManager.decreaseUserOperationCount(op)
            this.store.removeOutstanding(opInfo.userOperationHash)
            this.store.addProcessing(opInfo)
            result.push(opInfo)
            opsTaken++
        }
        return result
    }

    get(opHash: HexData32): UserOperation | null {
        const outstanding = this.store
            .dumpOutstanding()
            .find((op) => op.userOperationHash === opHash)
        if (outstanding) {
            return deriveUserOperation(outstanding.mempoolUserOperation)
        }

        const submitted = this.store
            .dumpSubmitted()
            .find((op) => op.userOperation.userOperationHash === opHash)
        if (submitted) {
            return deriveUserOperation(
                submitted.userOperation.mempoolUserOperation
            )
        }

        return null
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
            .map((userOpInfo) =>
                deriveUserOperation(userOpInfo.mempoolUserOperation)
            )
            .filter((uo: UserOperation) => {
                const [opNonceKey, opNonceValue] = getNonceKeyAndValue(uo.nonce)

                return (
                    uo.sender === userOperation.sender &&
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
