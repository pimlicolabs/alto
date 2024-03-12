import type { GasPriceManager, Metrics } from "@alto/utils"
import {
    type Address,
    type ExecutionResult,
    type ReferencedCodeHashes,
    RpcError,
    type StorageMap,
    ValidationErrors,
    type ValidationResultWithAggregation
} from "@entrypoint-0.7/types"
import type {
    StakeInfo,
    UnPackedUserOperation,
    ValidationResult
} from "@entrypoint-0.7/types"
import type { InterfaceValidator } from "@entrypoint-0.7/types"
import type { StateOverrides } from "@entrypoint-0.7/types"
import type { ApiVersion } from "@entrypoint-0.7/types"
import type { Logger } from "@alto/utils"
import { calcPreVerificationGas } from "@entrypoint-0.7/utils"
import { calcVerificationGasAndCallGasLimit } from "@entrypoint-0.7/utils"
import {
    zeroAddress,
    type Account,
    type Chain,
    type PublicClient,
    type Transport,
    pad,
    toHex,
    slice,
    type AccessList,
    type Hex,
    concat
} from "viem"
import { simulateHandleOp, simulateValidation } from "../EntryPointSimulations"
import {
    type StakeInfoEntities,
    associatedWith,
    isStaked,
    parseEntitySlots
} from "./TracerResultParser"

const maxUint48 = 2 ** 48 - 1

const createFakeKeccak = (
    userOperation: UnPackedUserOperation,
    simulatedValidationResult: (
        | ValidationResult
        | ValidationResultWithAggregation
    ) & {
        storageMap: StorageMap
        referencedContracts?: ReferencedCodeHashes
    }
): Hex[] => {
    const fakeKeccak: Hex[] = []

    for (let i = 0; i < 1000; i++) {
        simulatedValidationResult.factoryInfo &&
            userOperation.factory &&
            fakeKeccak.push(
                concat([
                    pad(
                        simulatedValidationResult.factoryInfo.addr as Hex
                    ).toLowerCase() as Hex,
                    toHex(i)
                ])
            )
        simulatedValidationResult.senderInfo &&
            fakeKeccak.push(
                concat([
                    pad(
                        simulatedValidationResult.senderInfo.addr as Hex
                    ).toLowerCase() as Hex,
                    toHex(i)
                ])
            )
        simulatedValidationResult.paymasterInfo &&
            userOperation.paymaster &&
            fakeKeccak.push(
                concat([
                    pad(
                        simulatedValidationResult.paymasterInfo.addr as Hex
                    ).toLowerCase() as Hex,
                    toHex(i)
                ])
            )
    }

    return fakeKeccak
}

export class UnsafeValidator implements InterfaceValidator {
    publicClient: PublicClient<Transport, Chain>
    entryPoint: Address
    logger: Logger
    metrics: Metrics
    utilityWallet: Account
    usingTenderly: boolean
    balanceOverrideEnabled: boolean
    disableExpirationCheck: boolean
    apiVersion: ApiVersion
    chainId: number
    entryPointSimulationsAddress: Address
    gasPriceManager: GasPriceManager

    constructor(
        publicClient: PublicClient<Transport, Chain>,
        entryPoint: Address,
        logger: Logger,
        metrics: Metrics,
        gasPriceManager: GasPriceManager,
        utilityWallet: Account,
        apiVersion: ApiVersion,
        entryPointSimulationsAddress: Address,
        usingTenderly = false,
        balanceOverrideEnabled = false,
        disableExpirationCheck = false
    ) {
        this.publicClient = publicClient
        this.entryPoint = entryPoint
        this.logger = logger
        this.metrics = metrics
        this.utilityWallet = utilityWallet
        this.usingTenderly = usingTenderly
        this.gasPriceManager = gasPriceManager
        this.balanceOverrideEnabled = balanceOverrideEnabled
        this.disableExpirationCheck = disableExpirationCheck
        this.apiVersion = apiVersion
        this.chainId = publicClient.chain.id
        this.entryPointSimulationsAddress = entryPointSimulationsAddress
    }

    async getExecutionResult(
        userOperation: UnPackedUserOperation,
        stateOverrides?: StateOverrides
    ): Promise<ExecutionResult> {
        const error = await simulateHandleOp(
            userOperation,
            this.entryPoint,
            this.publicClient,
            false,
            userOperation.sender,
            userOperation.callData,
            this.entryPointSimulationsAddress,
            stateOverrides
        )

        if (error.result === "failed") {
            throw new RpcError(
                `UserOperation reverted during simulation with reason: ${error.data}`,
                error.code ?? ValidationErrors.SimulateValidation,
                error.data
            )
        }

        return error.data
    }

    validateStorageAccessList(
        userOperation: UnPackedUserOperation,
        simulatedValidationResult: (
            | ValidationResult
            | ValidationResultWithAggregation
        ) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        },
        accessList: AccessList
    ) {
        const stakeInfoEntities: StakeInfoEntities = {
            factory: simulatedValidationResult.factoryInfo,
            account: simulatedValidationResult.senderInfo,
            paymaster: simulatedValidationResult.paymasterInfo
        }

        const fakeKeccak: Hex[] = createFakeKeccak(
            userOperation,
            simulatedValidationResult
        )

        const entitySlots: { [addr: string]: Set<string> } = parseEntitySlots(
            stakeInfoEntities,
            fakeKeccak
        )

        const accessListMap = accessList.reduce(
            (acc, { address, storageKeys }) => {
                acc[address.toLowerCase()] = {
                    address: address,
                    storageKeys
                }
                return acc
            },
            {} as Record<string, { address: Address; storageKeys: Hex[] }>
        ) as Record<string, { address: Address; storageKeys: Hex[] }>

        for (const [title, entStakes] of Object.entries(stakeInfoEntities)) {
            const entityTitle = title as keyof StakeInfoEntities

            if (!entStakes?.addr) {
                continue
            }

            const entityAddr = (entStakes?.addr ?? "").toLowerCase()

            for (const [addr, { storageKeys }] of Object.entries(
                accessListMap
            )) {
                if (addr === userOperation.sender.toLowerCase()) {
                    // allowed to access sender's storage
                    // [STO-010]
                    continue
                }
                if (addr === this.entryPoint.toLowerCase()) {
                    // ignore storage access on entryPoint (balance/deposit of entities.
                    // we block them on method calls: only allowed to deposit, never to read
                    continue
                }
                let requireStakeSlot: string | undefined

                for (const slot of storageKeys) {
                    if (
                        associatedWith(slot, userOperation.sender, entitySlots)
                    ) {
                        if (userOperation.factory) {
                            // special case: account.validateUserOp is allowed to use assoc storage if factory is staked.
                            // [STO-022], [STO-021]
                            if (
                                !(
                                    entityAddr ===
                                        userOperation.sender.toLowerCase() &&
                                    isStaked(stakeInfoEntities.factory)
                                )
                            ) {
                                requireStakeSlot = slot
                            }
                        }
                    } else if (associatedWith(slot, entityAddr, entitySlots)) {
                        // [STO-032]
                        // accessing a slot associated with entityAddr (e.g. token.balanceOf(paymaster)
                        requireStakeSlot = slot
                    } else if (addr === entityAddr) {
                        // [STO-031]
                        // accessing storage member of entity itself requires stake.
                        requireStakeSlot = slot
                    } else if (
                        slot !==
                        "0x0000000000000000000000000000000000000000000000000000000000000000"
                    ) {
                        requireStakeSlot = slot
                    }
                }

                function nameAddr(
                    addr: string,
                    _currentEntity: string
                ): string {
                    const [title] =
                        Object.entries(stakeInfoEntities).find(
                            ([_title, info]) =>
                                info?.addr?.toLowerCase() === addr.toLowerCase()
                        ) ?? []

                    return title ?? addr
                }

                requireCondAndStake(
                    requireStakeSlot !== undefined,
                    entStakes,
                    `un staked ${entityTitle} accessed ${nameAddr(
                        addr,
                        entityTitle
                    )} slot ${requireStakeSlot}`
                )
            }

            function requireCondAndStake(
                cond: boolean,
                entStake: StakeInfo | undefined,
                failureMessage: string
            ): void {
                if (!cond) {
                    return
                }
                if (!entStake) {
                    throw new Error(
                        `internal: ${entityTitle} not in userOp, but has storage accesses in`
                    )
                }
                if (!isStaked(entStake)) {
                    throw new RpcError(
                        failureMessage,
                        ValidationErrors.OpcodeValidation,
                        {
                            [entityTitle]: entStakes?.addr
                        }
                    )
                }
            }
        }
    }

    async getValidationResult(
        userOperation: UnPackedUserOperation,
        _codeHashes?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        const { simulateValidationResult } = await simulateValidation(
            userOperation,
            this.entryPoint,
            this.publicClient,
            this.entryPointSimulationsAddress
        )

        if (simulateValidationResult.status === "failed") {
            throw new RpcError(
                `UserOperation reverted with reason: ${
                    simulateValidationResult.data as string
                }`,
                ValidationErrors.SimulateValidation
            )
        }

        const validationResult =
            simulateValidationResult.data as ValidationResultWithAggregation

        const mergedValidation = this.mergeValidationDataValues(
            validationResult.returnInfo.accountValidationData,
            validationResult.returnInfo.paymasterValidationData
        )

        const res = {
            returnInfo: {
                ...validationResult.returnInfo,
                accountSigFailed: mergedValidation.accountSigFailed,
                paymasterSigFailed: mergedValidation.paymasterSigFailed,
                validUntil: mergedValidation.validUntil,
                validAfter: mergedValidation.validAfter
            },
            senderInfo: {
                ...validationResult.senderInfo,
                addr: userOperation.sender
            },
            factoryInfo:
                userOperation.factory && validationResult.factoryInfo
                    ? {
                          ...validationResult.factoryInfo,
                          addr: userOperation.factory
                      }
                    : undefined,
            paymasterInfo:
                userOperation.paymaster && validationResult.paymasterInfo
                    ? {
                          ...validationResult.paymasterInfo,
                          addr: userOperation.paymaster
                      }
                    : undefined,
            aggregatorInfo: validationResult.aggregatorInfo,
            storageMap: {}
        }

        // this.validateStorageAccessList(userOperation, res, accessList)

        if (res.returnInfo.accountSigFailed) {
            throw new RpcError(
                "Invalid UserOp signature",
                ValidationErrors.InvalidSignature
            )
        }

        if (res.returnInfo.paymasterSigFailed) {
            throw new RpcError(
                "Invalid UserOp paymasterData",
                ValidationErrors.InvalidSignature
            )
        }

        const now = Math.floor(Date.now() / 1000)

        if (res.returnInfo.validAfter > now - 5) {
            throw new RpcError(
                `User operation is not valid yet, validAfter=${res.returnInfo.validAfter}, now=${now}`,
                ValidationErrors.ExpiresShortly
            )
        }

        if (
            res.returnInfo.validUntil == null ||
            res.returnInfo.validUntil < now + 30
        ) {
            throw new RpcError(
                `UserOperation expires too soon, validUntil=${res.returnInfo.validUntil}, now=${now}`,
                ValidationErrors.ExpiresShortly
            )
        }

        return res
    }

    async validatePreVerificationGas(userOperation: UnPackedUserOperation) {
        const preVerificationGas = await calcPreVerificationGas(
            this.publicClient,
            userOperation,
            this.entryPoint,
            this.chainId
        )

        if (preVerificationGas > userOperation.preVerificationGas) {
            throw new RpcError(
                `preVerificationGas is not enough, required: ${preVerificationGas}, got: ${userOperation.preVerificationGas}`,
                ValidationErrors.SimulateValidation
            )
        }
    }

    async validateUserOperation(
        userOperation: UnPackedUserOperation,
        _referencedContracts?: ReferencedCodeHashes
    ): Promise<
        (ValidationResult | ValidationResultWithAggregation) & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        try {
            const validationResult =
                await this.getValidationResult(userOperation)

            const prefund = validationResult.returnInfo.prefund

            const [verificationGasLimit, callGasLimit] =
                await calcVerificationGasAndCallGasLimit(
                    this.publicClient,
                    userOperation,
                    {
                        preOpGas: validationResult.returnInfo.preOpGas,
                        paid: validationResult.returnInfo.prefund
                    },
                    this.chainId
                )

            const mul = userOperation.paymaster ? 3n : 1n

            const requiredPreFund =
                callGasLimit +
                verificationGasLimit * mul +
                userOperation.preVerificationGas

            if (requiredPreFund > prefund) {
                throw new RpcError(
                    `prefund is not enough, required: ${requiredPreFund}, got: ${prefund}`,
                    ValidationErrors.SimulateValidation
                )
            }

            this.metrics.userOperationsValidationSuccess.inc()

            return validationResult
        } catch (e) {
            // console.log(e)
            this.metrics.userOperationsValidationFailure.inc()
            throw e
        }
    }

    mergeValidationDataValues(
        accountValidationData: bigint,
        paymasterValidationData: bigint
    ): {
        paymasterSigFailed: boolean
        accountSigFailed: boolean
        validAfter: number
        validUntil: number
    } {
        return this.mergeValidationData(
            this.parseValidationData(accountValidationData),
            this.parseValidationData(paymasterValidationData)
        )
    }

    mergeValidationData(
        accountValidationData: {
            aggregator: string
            validAfter: number
            validUntil: number
        },
        paymasterValidationData: {
            aggregator: string
            validAfter: number
            validUntil: number
        }
    ): {
        paymasterSigFailed: boolean
        accountSigFailed: boolean
        validAfter: number
        validUntil: number
    } {
        return {
            paymasterSigFailed:
                paymasterValidationData.aggregator !== zeroAddress,
            accountSigFailed: accountValidationData.aggregator !== zeroAddress,
            validAfter: Math.max(
                accountValidationData.validAfter,
                paymasterValidationData.validAfter
            ),
            validUntil: Math.min(
                accountValidationData.validUntil,
                paymasterValidationData.validUntil
            )
        }
    }

    parseValidationData(validationData: bigint): {
        aggregator: string
        validAfter: number
        validUntil: number
    } {
        const data = pad(toHex(validationData), { size: 32 })

        // string offsets start from left (msb)
        const aggregator = slice(data, 32 - 20)
        let validUntil = Number.parseInt(slice(data, 32 - 26, 32 - 20), 16)
        if (validUntil === 0) {
            validUntil = maxUint48
        }
        const validAfter = Number.parseInt(slice(data, 0, 6), 16)

        return {
            aggregator,
            validAfter,
            validUntil
        }
    }
}
