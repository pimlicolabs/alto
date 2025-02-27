import type { EventManager } from "@alto/handlers"
import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    type InterfaceValidator,
    type ReferencedCodeHashes,
    RpcError,
    type StorageMap,
    type SubmittedUserOp,
    type TransactionInfo,
    type UserOperation,
    type UserOperationBundle,
    type UserOpInfo,
    ValidationErrors,
    type ValidationResult,
    type Address
} from "@alto/types"
import type { Logger } from "@alto/utils"
import {
    getAddressFromInitCodeOrPaymasterAndData,
    getNonceKeyAndSequence,
    getUserOperationHash,
    isVersion06,
    isVersion07,
    scaleBigIntByPercent
} from "@alto/utils"
import { getAddress, getContract } from "viem"
import type { Monitor } from "./monitoring"
import {
    type InterfaceReputationManager,
    ReputationStatuses
} from "./reputationManager"
import type { AltoConfig } from "../createConfig"
import { MempoolStore } from "@alto/store"

export class Mempool {
    private config: AltoConfig
    private monitor: Monitor
    private reputationManager: InterfaceReputationManager
    private store: MempoolStore
    private throttledEntityBundleCount: number
    private logger: Logger
    private validator: InterfaceValidator
    private eventManager: EventManager

    constructor({
        config,
        monitor,
        reputationManager,
        validator,
        store,
        eventManager
    }: {
        config: AltoConfig
        monitor: Monitor
        reputationManager: InterfaceReputationManager
        validator: InterfaceValidator
        store: MempoolStore
        eventManager: EventManager
    }) {
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

    async replaceSubmitted({
        userOpInfo,
        transactionInfo
    }: {
        userOpInfo: UserOpInfo
        transactionInfo: TransactionInfo
    }) {
        const entryPoint = transactionInfo.bundle.entryPoint
        const { userOpHash } = userOpInfo
        const sumbittedUserOps = await this.store.dumpSubmitted(entryPoint)
        const existingUserOpToReplace = sumbittedUserOps.find(
            (userOpInfo) => userOpInfo.userOpHash === userOpHash
        )

        if (existingUserOpToReplace) {
            this.store.removeSubmitted({ entryPoint, userOpHash })
            this.store.addSubmitted({
                entryPoint,
                submittedUserOp: {
                    ...userOpInfo,
                    transactionInfo
                }
            })
            this.monitor.setUserOperationStatus(userOpHash, {
                status: "submitted",
                transactionHash: transactionInfo.transactionHash
            })
        }
    }

    async markSubmitted({
        userOpHash,
        transactionInfo
    }: {
        userOpHash: Address
        transactionInfo: TransactionInfo
    }) {
        const entryPoint = transactionInfo.bundle.entryPoint
        const processingUserOps = await this.store.dumpProcessing(entryPoint)
        const processingUserOp = processingUserOps.find(
            (userOpInfo) => userOpInfo.userOpHash === userOpHash
        )

        if (processingUserOp) {
            this.store.removeProcessing({ entryPoint, userOpHash })
            this.store.addSubmitted({
                entryPoint,
                submittedUserOp: {
                    ...processingUserOp,
                    transactionInfo
                }
            })
            this.monitor.setUserOperationStatus(userOpHash, {
                status: "submitted",
                transactionHash: transactionInfo.transactionHash
            })
        }
    }

    async dumpOutstanding(entryPoint: Address): Promise<UserOperation[]> {
        return (await this.store.dumpOutstanding(entryPoint)).map(
            ({ userOp }) => userOp
        )
    }

    async dumpProcessing(entryPoint: Address): Promise<UserOpInfo[]> {
        return await this.store.dumpProcessing(entryPoint)
    }

    async dumpSubmittedOps(entryPoint: Address): Promise<SubmittedUserOp[]> {
        return await this.store.dumpSubmitted(entryPoint)
    }

    async removeSubmitted({
        entryPoint,
        userOpHash
    }: { entryPoint: Address; userOpHash: `0x${string}` }) {
        await this.store.removeSubmitted({ entryPoint, userOpHash })
    }

    async removeProcessing({
        entryPoint,
        userOpHash
    }: { entryPoint: Address; userOpHash: `0x${string}` }) {
        await this.store.removeProcessing({ entryPoint, userOpHash })
    }

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

    // TODO: add check for adding a userop with conflicting nonce
    // In case of concurrent requests
    async add(
        userOp: UserOperation,
        entryPoint: Address,
        referencedContracts?: ReferencedCodeHashes
    ): Promise<[boolean, string]> {
        const userOpHash = getUserOperationHash(
            userOp,
            entryPoint,
            this.config.chainId
        )

        const outstandingOps = await this.store.dumpOutstanding(entryPoint)
        const submittedOps = await this.store.dumpSubmitted(entryPoint)
        const processingOps = await this.store.dumpProcessing(entryPoint)

        const processedOrSubmittedOps = [...processingOps, ...submittedOps]

        // Check if the exact same userOperation is already in the mempool.
        const existingUserOperation = [
            ...outstandingOps,
            ...processedOrSubmittedOps
        ].find((userOpInfo) => userOpInfo.userOpHash === userOpHash)

        if (existingUserOperation) {
            return [false, "Already known"]
        }

        if (
            processedOrSubmittedOps.find((userOpInfo) => {
                const { userOp: mempoolUserOp } = userOpInfo
                return (
                    mempoolUserOp.sender === userOp.sender &&
                    mempoolUserOp.nonce === userOp.nonce
                )
            })
        ) {
            return [
                false,
                "AA25 invalid account nonce: User operation is already in mempool and getting processed with same nonce and sender"
            ]
        }

        const oldUserOpInfo = [
            ...outstandingOps,
            ...processedOrSubmittedOps
        ].find((userOpInfo) => {
            const { userOp: mempoolUserOp } = userOpInfo

            const isSameSender = mempoolUserOp.sender === userOp.sender
            if (isSameSender && mempoolUserOp.nonce === userOp.nonce) {
                return true
            }

            // Check if there is already a userOperation with initCode + same sender (stops rejected ops due to AA10).
            if (
                isVersion06(mempoolUserOp) &&
                isVersion06(userOp) &&
                userOp.initCode &&
                userOp.initCode !== "0x"
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
                isVersion07(userOp) &&
                userOp.factory &&
                userOp.factory !== "0x"
            ) {
                return (
                    isSameSender &&
                    mempoolUserOp.factory &&
                    mempoolUserOp.factory !== "0x"
                )
            }

            return false
        })

        const isOldUserOpProcessingOrSubmitted = processedOrSubmittedOps.some(
            (userOpInfo) => userOpInfo.userOpHash === oldUserOpInfo?.userOpHash
        )

        if (oldUserOpInfo) {
            const { userOp: oldUserOp } = oldUserOpInfo
            let reason =
                "AA10 sender already constructed: A conflicting userOperation with initCode for this sender is already in the mempool. bump the gas price by minimum 10%"

            if (oldUserOp.nonce === userOp.nonce) {
                reason =
                    "AA25 invalid account nonce: User operation already present in mempool, bump the gas price by minimum 10%"
            }

            // if oldOp is already in processing or submitted mempool, we can't replace it so early exit.
            if (isOldUserOpProcessingOrSubmitted) {
                return [false, reason]
            }

            const oldOp = oldUserOp
            const newOp = userOp

            const hasHigherPriorityFee =
                newOp.maxPriorityFeePerGas >=
                scaleBigIntByPercent(oldOp.maxPriorityFeePerGas, 110n)

            const hasHigherMaxFee =
                newOp.maxFeePerGas >=
                scaleBigIntByPercent(oldOp.maxFeePerGas, 110n)

            const hasHigherFees = hasHigherPriorityFee && hasHigherMaxFee

            if (!hasHigherFees) {
                return [false, reason]
            }

            await this.store.removeOutstanding({
                entryPoint,
                userOpHash: oldUserOpInfo.userOpHash
            })
            this.reputationManager.replaceUserOperationSeenStatus(
                oldOp,
                entryPoint
            )
        }

        this.reputationManager.increaseUserOperationSeenStatus(
            userOp,
            entryPoint
        )

        // Check if mempool already includes max amount of parallel user operations
        const parallelUserOperationsCount = outstandingOps.filter(
            (userOpInfo) => {
                const { userOp: mempoolUserOp } = userOpInfo
                return mempoolUserOp.sender === userOp.sender
            }
        ).length

        if (parallelUserOperationsCount > this.config.mempoolMaxParallelOps) {
            return [
                false,
                "AA25 invalid account nonce: Maximum number of parallel user operations for that is allowed for this sender reached"
            ]
        }

        // Check if mempool already includes max amount of queued user operations
        const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)
        const queuedUserOperationsCount = outstandingOps.filter(
            (userOpInfo) => {
                const { userOp: mempoolUserOp } = userOpInfo
                const [opNonceKey] = getNonceKeyAndSequence(mempoolUserOp.nonce)

                return (
                    mempoolUserOp.sender === userOp.sender &&
                    opNonceKey === nonceKey
                )
            }
        ).length

        if (queuedUserOperationsCount > this.config.mempoolMaxQueuedOps) {
            return [
                false,
                "AA25 invalid account nonce: Maximum number of queued user operations reached for this sender and nonce key"
            ]
        }

        await this.store.addOutstanding({
            entryPoint,
            userOpInfo: {
                userOp,
                userOpHash,
                referencedContracts,
                addedToMempool: Date.now()
            }
        })
        this.monitor.setUserOperationStatus(userOpHash, {
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
            this.store.removeOutstanding({ entryPoint, userOpHash })
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
            let queuedUserOperations: UserOperation[] = []

            if (!isUserOpV06) {
                queuedUserOperations = await this.getQueuedUserOperations(
                    userOp,
                    entryPoint
                )
            }

            validationResult = await this.validator.validateUserOperation({
                shouldCheckPrefund: false,
                userOperation: userOp,
                queuedUserOperations,
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
            this.reputationManager.decreaseUserOperationSeenStatus(
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
        const isV6 = isVersion06(firstOp.userOp)
        const bundles: UserOperationBundle[] = []

        // Process operations until no more are available or we hit maxBundleCount
        while (await this.store.peekOutstanding(entryPoint)) {
            // If maxBundles is set and we reached the limit, break
            if (maxBundleCount && bundles.length >= maxBundleCount) {
                break
            }

            // Setup for next bundle
            const currentBundle: UserOperationBundle = {
                entryPoint,
                version: isV6 ? "0.6" : "0.7",
                userOps: []
            }
            let gasUsed = 0n
            let paymasterDeposit: { [paymaster: string]: bigint } = {}
            let stakedEntityCount: { [addr: string]: number } = {}
            let senders = new Set<string>()
            let knownEntities = await this.getKnownEntities(entryPoint)
            let storageMap: StorageMap = {}

            // Keep adding ops to current bundle
            while (await this.store.peekOutstanding(entryPoint)) {
                const userOpInfo = await this.store.popOutstanding(entryPoint)
                if (!userOpInfo) break

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

                if (skipResult.skip) continue

                gasUsed +=
                    userOp.callGasLimit +
                    userOp.verificationGasLimit +
                    (isVersion07(userOp)
                        ? (userOp.paymasterPostOpGasLimit || 0n) +
                          (userOp.paymasterVerificationGasLimit || 0n)
                        : 0n)

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

                this.reputationManager.decreaseUserOperationCount(userOp)
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

    // For a specfic user operation, get all the queued user operations
    // They should be executed first, ordered by nonce value
    // If cuurentNonceValue is not provided, it will be fetched from the chain
    async getQueuedUserOperations(
        userOp: UserOperation,
        entryPoint: Address,
        _currentNonceValue?: bigint
    ): Promise<UserOperation[]> {
        const entryPointContract = getContract({
            address: entryPoint,
            abi: isVersion06(userOp) ? EntryPointV06Abi : EntryPointV07Abi,
            client: {
                public: this.config.publicClient
            }
        })

        const [nonceKey, nonceSequence] = getNonceKeyAndSequence(userOp.nonce)

        let currentNonceSequence: bigint = BigInt(0)

        if (_currentNonceValue) {
            currentNonceSequence = _currentNonceValue
        } else {
            const getNonceResult = await entryPointContract.read.getNonce(
                [userOp.sender, nonceKey],
                {
                    blockTag: "latest"
                }
            )

            currentNonceSequence = getNonceKeyAndSequence(getNonceResult)[1]
        }

        const outstandingOps = await this.store.dumpOutstanding(entryPoint)
        const outstanding = outstandingOps.filter((userOpInfo) => {
            const { userOp: mempoolUserOp } = userOpInfo

            const [mempoolNonceKey, mempoolNonceSequence] =
                getNonceKeyAndSequence(mempoolUserOp.nonce)

            let isPaymasterSame = false

            if (isVersion07(userOp) && isVersion07(mempoolUserOp)) {
                isPaymasterSame =
                    mempoolUserOp.paymaster === userOp.paymaster &&
                    !(
                        mempoolUserOp.sender === userOp.sender &&
                        mempoolNonceKey === nonceKey &&
                        mempoolNonceSequence === nonceSequence
                    ) &&
                    userOp.paymaster !== null
            }

            return (
                (mempoolUserOp.sender === userOp.sender &&
                    mempoolNonceKey === nonceKey &&
                    mempoolNonceSequence >= currentNonceSequence &&
                    mempoolNonceSequence < nonceSequence) ||
                isPaymasterSame
            )
        })

        return outstanding
            .sort((a, b) => {
                const aUserOp = a.userOp
                const bUserOp = b.userOp

                const [, aNonceValue] = getNonceKeyAndSequence(aUserOp.nonce)
                const [, bNonceValue] = getNonceKeyAndSequence(bUserOp.nonce)

                return Number(aNonceValue - bNonceValue)
            })
            .map((userOpInfo) => userOpInfo.userOp)
    }

    clear(): void {
        for (const entryPoint of this.config.entrypoints) {
            this.store.clear({ entryPoint, from: "outstanding" })
        }
    }
}
