// import { MongoClient, Collection, Filter } from "mongodb"
// import { PublicClient, getContract } from "viem"
// import { EntryPointAbi } from "../types/EntryPoint"
import {
    RpcError,
    StorageMap,
    SubmittedUserOperation,
    TransactionInfo,
    UserOperation,
    UserOperationInfo,
    ValidationErrors,
    IValidator,
    ValidationResult,
    EntryPointAbi,
    ReferencedCodeHashes,
    MempoolUserOperation,
    deriveUserOperation
} from "@alto/types"
import { HexData32 } from "@alto/types"
import { Monitor } from "./monitoring"
import {
    Address,
    Chain,
    PublicClient,
    Transport,
    getAddress,
    getContract
} from "viem"
import {
    Logger,
    Metrics,
    getAddressFromInitCodeOrPaymasterAndData,
    getUserOperationHash
} from "@alto/utils"
import { MemoryStore } from "./store"
import { IReputationManager, ReputationStatuses } from "./reputationManager"
import { Mempool } from "./types"

export class MemoryMempool implements Mempool {
    private monitor: Monitor
    private publicClient: PublicClient<Transport, Chain>
    private entryPointAddress: Address
    private reputationManager: IReputationManager
    private store: MemoryStore
    private throttledEntityBundleCount: number
    private logger: Logger
    private validator: IValidator
    private safeMode: boolean

    constructor(
        monitor: Monitor,
        reputationManager: IReputationManager,
        validator: IValidator,
        publicClient: PublicClient<Transport, Chain>,
        entryPointAddress: Address,
        safeMode: boolean,
        logger: Logger,
        metrics: Metrics,
        throttledEntityBundleCount?: number
    ) {
        this.reputationManager = reputationManager
        this.monitor = monitor
        this.validator = validator
        this.publicClient = publicClient
        this.entryPointAddress = entryPointAddress
        this.safeMode = safeMode
        this.logger = logger
        this.store = new MemoryStore(logger, metrics)
        this.throttledEntityBundleCount = throttledEntityBundleCount ?? 4
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

    // biome-ignore lint/nursery/useAwait: keep async to adhere to interface
    async checkEntityMultipleRoleViolation(op: UserOperation): Promise<void> {
        if (!this.safeMode) { return }
        const knownEntities = this.getKnownEntities()

        if (
            knownEntities.paymasters.has(op.sender) ||
            knownEntities.facotries.has(op.sender)
        ) {
            throw new RpcError(
                `The sender address "${op.sender}" is used as a different entity in another UserOperation currently in mempool`,
                ValidationErrors.OpcodeValidation
            )
        }

        const paymaster = getAddressFromInitCodeOrPaymasterAndData(
            op.paymasterAndData
        )

        if (paymaster && knownEntities.sender.has(paymaster)) {
            throw new RpcError(
                `A Paymaster at ${paymaster} in this UserOperation is used as a sender entity in another UserOperation currently in mempool.`,
                ValidationErrors.OpcodeValidation
            )
        }

        const factory = getAddressFromInitCodeOrPaymasterAndData(op.initCode)

        if (factory && knownEntities.sender.has(factory)) {
            throw new RpcError(
                `A Factory at ${factory} in this UserOperation is used as a sender entity in another UserOperation currently in mempool.`,
                ValidationErrors.OpcodeValidation
            )
        }
    }

    getKnownEntities(): {
        sender: Set<Address>
        paymasters: Set<Address>
        facotries: Set<Address>
    } {
        const allOps = [...this.store.dumpOutstanding()]

        const entities: {
            sender: Set<Address>
            paymasters: Set<Address>
            facotries: Set<Address>
        } = {
            sender: new Set(),
            paymasters: new Set(),
            facotries: new Set()
        }

        for (const mempoolOp of allOps) {
            const op = deriveUserOperation(mempoolOp.mempoolUserOperation)
            entities.sender.add(op.sender)
            const paymaster = getAddressFromInitCodeOrPaymasterAndData(
                op.paymasterAndData
            )
            if (paymaster) {
                entities.paymasters.add(paymaster)
            }
            const factory = getAddressFromInitCodeOrPaymasterAndData(
                op.initCode
            )
            if (factory) {
                entities.facotries.add(factory)
            }
        }

        return entities
    }

    add(mempoolUserOperation: MempoolUserOperation, referencedContracts?: ReferencedCodeHashes) {
        const op = deriveUserOperation(mempoolUserOperation)

        const outstandingOps = [...this.store.dumpOutstanding()]

        const processedOrSubmittedOps = [
            ...this.store.dumpProcessing(),
            ...this.store.dumpSubmitted().map((sop) => sop.userOperation)
        ]

        if (
            processedOrSubmittedOps.find(
                (uo) => {
                    const userOp = deriveUserOperation(uo.mempoolUserOperation)
                    userOp.sender === op.sender &&
                    userOp.nonce === op.nonce
                }
            )
        ) {
            return false
        }

        this.reputationManager.updateUserOperationSeenStatus(op)
        const oldUserOp = outstandingOps.find(
            (uo) => {
                const userOp = deriveUserOperation(uo.mempoolUserOperation)
                userOp.sender === op.sender &&
                userOp.nonce === op.nonce
            }
        )
        if (oldUserOp) {
            const oldOp = deriveUserOperation(oldUserOp.mempoolUserOperation)
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
                return false
            }

            this.store.removeOutstanding(oldUserOp.userOperationHash)
        }

        const hash = getUserOperationHash(
            op,
            this.entryPointAddress,
            this.publicClient.chain.id
        )

        this.store.addOutstanding({
            mempoolUserOperation,
            userOperationHash: hash,
            firstSubmitted: oldUserOp ? oldUserOp.firstSubmitted : Date.now(),
            lastReplaced: Date.now(),
            referencedContracts
        })
        this.monitor.setUserOperationStatus(hash, {
            status: "not_submitted",
            transactionHash: null
        })

        return true
    }

    async shouldSkip(
        opInfo: UserOperationInfo,
        paymasterDeposit: { [paymaster: string]: bigint },
        stakedEntityCount: { [addr: string]: number },
        knownEntities: {
            sender: Set<`0x${string}`>
            paymasters: Set<`0x${string}`>
            facotries: Set<`0x${string}`>
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
            facotries: Set<`0x${string}`>
        }
        senders: Set<string>
        storageMap: StorageMap
    }> {
        const op = deriveUserOperation(opInfo.mempoolUserOperation)
        if (!this.safeMode) {
            return {
                skip: false,
                paymasterDeposit,
                stakedEntityCount,
                knownEntities,
                senders,
                storageMap
            }
        }
        const paymaster = getAddressFromInitCodeOrPaymasterAndData(
            op.paymasterAndData
        )
        const factory = getAddressFromInitCodeOrPaymasterAndData(
            op.initCode
        )
        const paymasterStatus = this.reputationManager.getStatus(paymaster)
        const factoryStatus = this.reputationManager.getStatus(factory)

        if (
            paymasterStatus === ReputationStatuses.BANNED ||
            factoryStatus === ReputationStatuses.BANNED
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
            paymasterStatus === ReputationStatuses.THROTTLED &&
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
            factoryStatus === ReputationStatuses.THROTTLED &&
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

        if (senders.has(op.sender)) {
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
            validationResult = await this.validator.validateUserOperation(
                op,
                opInfo.referencedContracts
            )
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

            if (
                address !== op.sender &&
                knownEntities.sender.has(address)
            ) {
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
                    abi: EntryPointAbi,
                    address: this.entryPointAddress,
                    publicClient: this.publicClient
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
    ): Promise<MempoolUserOperation[]> {
        const outstandingUserOperations = this.store.dumpOutstanding().slice()
        let opsTaken = 0
        let gasUsed = 0n
        const result: MempoolUserOperation[] = []

        // paymaster deposit should be enough for all UserOps in the bundle.
        let paymasterDeposit: { [paymaster: string]: bigint } = {}
        // throttled paymasters and deployers are allowed only small UserOps per bundle.
        let stakedEntityCount: { [addr: string]: number } = {}
        // each sender is allowed only once per bundle
        let senders = new Set<string>()
        let knownEntities = this.getKnownEntities()

        let storageMap: StorageMap = {}

        for (const opInfo of outstandingUserOperations) {
            const op = deriveUserOperation(opInfo.mempoolUserOperation)
            gasUsed +=
                op.callGasLimit +
                op.verificationGasLimit * 3n +
                op.preVerificationGas
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

            this.reputationManager.decreaseUserOperationCount(
                op
            )
            this.store.removeOutstanding(opInfo.userOperationHash)
            this.store.addProcessing(opInfo)
            result.push(opInfo.mempoolUserOperation)
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
            return deriveUserOperation(submitted.userOperation.mempoolUserOperation)
        }

        return null
    }

    clear(): void {
        this.store.clear("outstanding")
    }
}
