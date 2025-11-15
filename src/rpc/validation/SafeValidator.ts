import type { SenderManager } from "@alto/executor"
import type { GasPriceManager } from "@alto/handlers"
import {
    type Address,
    CodeHashGetterAbi,
    CodeHashGetterBytecode,
    ERC7769Errors,
    EntryPointV06Abi,
    type InterfaceValidator,
    type ReferencedCodeHashes,
    RpcError,
    type StakeInfo,
    type StorageMap,
    type UserOperation,
    type UserOperation06,
    type UserOperation07,
    type ValidationResult,
    type ValidationResult06,
    type ValidationResult07,
    pimlicoSimulationsAbi
} from "@alto/types"
import type { Metrics } from "@alto/utils"
import {
    getAddressFromInitCodeOrPaymasterAndData,
    getAuthorizationStateOverrides,
    isVersion08,
    jsonStringifyWithBigint,
    toPackedUserOp
} from "@alto/utils"
import {
    type ExecutionRevertedError,
    type Hex,
    decodeErrorResult,
    encodeDeployData,
    encodeFunctionData,
    zeroAddress
} from "viem"
import type { AltoConfig } from "../../createConfig"
import {
    type BundlerTracerResult,
    type ExitInfo,
    bundlerCollectorTracer
} from "./BundlerCollectorTracerV07"
import { tracerResultParserV06 } from "./TracerResultParserV06"
import { tracerResultParserV07 } from "./TracerResultParserV07"
import { UnsafeValidator } from "./UnsafeValidator"
import { debug_traceCall } from "./tracer"

export class SafeValidator
    extends UnsafeValidator
    implements InterfaceValidator
{
    private readonly senderManager: SenderManager

    constructor({
        config,
        senderManager,
        metrics,
        gasPriceManager
    }: {
        config: AltoConfig
        senderManager: SenderManager
        metrics: Metrics
        gasPriceManager: GasPriceManager
    }) {
        super({
            config,
            metrics,
            gasPriceManager
        })
        this.senderManager = senderManager
    }

    async validateUserOp(args: {
        userOp: UserOperation
        queuedUserOps: UserOperation[]
        entryPoint: Address
        referencedContracts?: ReferencedCodeHashes
    }): Promise<
        ValidationResult & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        const { userOp, queuedUserOps, entryPoint, referencedContracts } = args
        try {
            const validationResult = await this.getValidationResult({
                userOp,
                queuedUserOps,
                entryPoint,
                codeHashes: referencedContracts
            })

            this.metrics.userOpsValidationSuccess.inc()

            return validationResult
        } catch (e) {
            this.metrics.userOpsValidationFailure.inc()
            throw e
        }
    }

    async getCodeHashes(addresses: string[]): Promise<ReferencedCodeHashes> {
        const deployData = encodeDeployData({
            abi: CodeHashGetterAbi,
            bytecode: CodeHashGetterBytecode,
            args: [addresses]
        })

        const wallet = await this.senderManager.getWallet()

        let hash = ""

        try {
            await this.config.publicClient.call({
                account: wallet,
                data: deployData
            })
        } catch (e) {
            const error = e as ExecutionRevertedError
            // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
            hash = (error.walk() as any).data
        }

        this.senderManager.markWalletProcessed(wallet)

        return {
            hash,
            addresses
        }
    }

    async getValidationResult07(args: {
        userOp: UserOperation07
        queuedUserOps: UserOperation[]
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        ValidationResult07 & {
            storageMap: StorageMap
            referencedContracts?: ReferencedCodeHashes
        }
    > {
        const { userOp, queuedUserOps, entryPoint, codeHashes } = args
        if (codeHashes && codeHashes.addresses.length > 0) {
            const { hash } = await this.getCodeHashes(codeHashes.addresses)
            if (hash !== codeHashes.hash) {
                throw new RpcError(
                    "code hashes mismatch",
                    ERC7769Errors.OpcodeValidation
                )
            }
        }

        const [res, tracerResult] = await this.getValidationResultWithTracerV07(
            userOp,
            queuedUserOps as UserOperation07[],
            entryPoint
        )

        const [contractAddresses, storageMap] = tracerResultParserV07(
            userOp,
            tracerResult,
            res,
            entryPoint.toLowerCase() as Address
        )

        const referencedContracts: ReferencedCodeHashes =
            codeHashes || (await this.getCodeHashes(contractAddresses))

        // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        if ((res as any) === "0x") {
            throw new Error(
                "simulateValidation reverted with no revert string!"
            )
        }

        if (res.returnInfo.accountSigFailed) {
            throw new RpcError(
                "Invalid UserOp signature",
                ERC7769Errors.InvalidSignature
            )
        }

        if (res.returnInfo.paymasterSigFailed) {
            throw new RpcError(
                "Invalid UserOp paymasterData",
                ERC7769Errors.InvalidSignature
            )
        }

        return {
            ...res,
            referencedContracts,
            storageMap
        }
    }

    async getValidationResult06(args: {
        userOp: UserOperation06
        entryPoint: Address
        codeHashes?: ReferencedCodeHashes
    }): Promise<
        ValidationResult06 & {
            referencedContracts?: ReferencedCodeHashes
            storageMap: StorageMap
        }
    > {
        const { userOp, entryPoint, codeHashes } = args
        if (codeHashes && codeHashes.addresses.length > 0) {
            const { hash } = await this.getCodeHashes(codeHashes.addresses)
            if (hash !== codeHashes.hash) {
                throw new RpcError(
                    "code hashes mismatch",
                    ERC7769Errors.OpcodeValidation
                )
            }
        }

        const [res, tracerResult] = await this.getValidationResultWithTracerV06(
            userOp,
            entryPoint
        )

        const [contractAddresses, storageMap] = tracerResultParserV06(
            userOp,
            tracerResult,
            res,
            entryPoint.toLowerCase() as Address
        )

        const referencedContracts: ReferencedCodeHashes =
            codeHashes || (await this.getCodeHashes(contractAddresses))

        // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        if ((res as any) === "0x") {
            throw new Error(
                "simulateValidation reverted with no revert string!"
            )
        }
        const validationResult = {
            ...res,
            referencedContracts,
            storageMap
        }

        if (validationResult.returnInfo.sigFailed) {
            throw new RpcError(
                "Invalid UserOp signature or paymaster signature",
                ERC7769Errors.InvalidSignature
            )
        }

        const now = Date.now() / 1000

        this.logger.debug({
            validAfter: validationResult.returnInfo.validAfter,
            validUntil: validationResult.returnInfo.validUntil,
            now: now
        })

        if (validationResult.returnInfo.validAfter > now - 5) {
            throw new RpcError(
                "User operation is not valid yet",
                ERC7769Errors.ExpiresShortly
            )
        }

        if (validationResult.returnInfo.validUntil < now + 30) {
            throw new RpcError("expires too soon", ERC7769Errors.ExpiresShortly)
        }

        return validationResult
    }

    async getValidationResultWithTracerV06(
        userOp: UserOperation06,
        entryPoint: Address
    ): Promise<[ValidationResult06, BundlerTracerResult]> {
        const stateOverrides = getAuthorizationStateOverrides({
            userOps: [userOp]
        })

        const tracerResult = await debug_traceCall(
            this.config.publicClient,
            {
                from: zeroAddress,
                to: entryPoint,
                data: encodeFunctionData({
                    abi: EntryPointV06Abi,
                    functionName: "simulateValidation",
                    args: [userOp]
                })
            },
            {
                tracer: bundlerCollectorTracer,
                stateOverrides
            }
        )

        const lastResult = tracerResult.calls.slice(-1)[0]
        if (lastResult.type !== "REVERT") {
            throw new Error("Invalid response. simulateCall must revert")
        }

        const data = (lastResult as ExitInfo).data
        if (data === "0x") {
            // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
            return [data as any, tracerResult]
        }

        try {
            const { errorName, args: errorArgs } = decodeErrorResult({
                abi: EntryPointV06Abi,
                data
            })

            const errFullName = `${errorName}(${errorArgs.toString()})`
            const errorResult = this.parseErrorResultV06(userOp, {
                errorName,
                errorArgs
            })
            if (!errorName.includes("Result")) {
                // a real error, not a result.
                throw new Error(errFullName)
            }
            // @ts-ignore
            return [errorResult, tracerResult]
            // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        } catch (e: any) {
            // if already parsed, throw as is
            if (e.code != null) {
                throw e
            }
            throw new RpcError(data)
        }
    }

    parseErrorResultV06(
        userOp: UserOperation06,
        // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        errorResult: { errorName: string; errorArgs: any }
    ): ValidationResult {
        if (!errorResult?.errorName?.startsWith("ValidationResult")) {
            // parse it as FailedOp
            // if its FailedOp, then we have the paymaster param... otherwise its an Error(string)
            let paymaster = errorResult.errorArgs.paymaster
            if (paymaster === zeroAddress) {
                paymaster = undefined
            }

            // eslint-disable-next-line
            const msg: string =
                errorResult.errorArgs[1] ?? errorResult.toString()

            if (paymaster == null) {
                throw new RpcError(
                    `account validation failed: ${msg}`,
                    ERC7769Errors.SimulateValidation
                )
            }
            throw new RpcError(
                `paymaster validation failed: ${msg}`,
                ERC7769Errors.SimulatePaymasterValidation,
                {
                    paymaster
                }
            )
        }

        const [
            returnInfo,
            senderInfo,
            factoryInfo,
            paymasterInfo,
            aggregatorInfo // may be missing (exists only SimulationResultWithAggregator)
        ] = errorResult.errorArgs

        // extract address from "data" (first 20 bytes)
        // add it as "addr" member to the "stakeinfo" struct
        // if no address, then return "undefined" instead of struct.
        function fillEntity(data: Hex, info: StakeInfo): StakeInfo | undefined {
            const addr = getAddressFromInitCodeOrPaymasterAndData(data)
            return addr == null
                ? undefined
                : {
                      ...info,
                      addr
                  }
        }

        function fillEntityAggregator(
            data: Hex,
            info: StakeInfo
        ): { aggregator: Address; stakeInfo: StakeInfo } | undefined {
            const addr = getAddressFromInitCodeOrPaymasterAndData(data)
            return addr == null
                ? undefined
                : {
                      aggregator: data,
                      stakeInfo: {
                          ...info,
                          addr
                      }
                  }
        }

        return {
            returnInfo,
            senderInfo: {
                ...senderInfo,
                addr: userOp.sender
            },
            factoryInfo: fillEntity(userOp.initCode, factoryInfo),
            paymasterInfo: fillEntity(userOp.paymasterAndData, paymasterInfo),
            aggregatorInfo: fillEntityAggregator(
                aggregatorInfo?.actualAggregator,
                aggregatorInfo?.stakeInfo
            )
        }
    }

    async getValidationResultWithTracerV07(
        userOp: UserOperation07,
        queuedUserOps: UserOperation07[],
        entryPoint: Address
    ): Promise<[ValidationResult07, BundlerTracerResult]> {
        const packedUserOp = toPackedUserOp(userOp)
        const packedQueuedUserOps = queuedUserOps.map((uop) =>
            toPackedUserOp(uop)
        )

        const isV8 = isVersion08(userOp, entryPoint)

        const entryPointSimulationsAddress = isV8
            ? this.config.entrypointSimulationContractV8
            : this.config.entrypointSimulationContractV7

        const pimlicoSimulationsAddress = this.config.pimlicoSimulationContract

        if (!entryPointSimulationsAddress || !pimlicoSimulationsAddress) {
            throw new Error(
                "Entrypoint simulations contract not found for this version"
            )
        }

        const entryPointSimulationsCallData = encodeFunctionData({
            abi: pimlicoSimulationsAbi,
            functionName: "simulateValidation",
            args: [
                entryPointSimulationsAddress,
                entryPoint,
                packedQueuedUserOps,
                packedUserOp
            ]
        })

        const stateOverrides = getAuthorizationStateOverrides({
            userOps: [userOp]
        })

        const tracerResult = await debug_traceCall(
            this.config.publicClient,
            {
                from: zeroAddress,
                to: pimlicoSimulationsAddress,
                data: entryPointSimulationsCallData
            },
            {
                tracer: bundlerCollectorTracer,
                stateOverrides
            }
        )

        this.logger.info(
            `tracerResult: ${jsonStringifyWithBigint(tracerResult)}`
        )

        const lastResult = tracerResult.calls.slice(-1)[0]
        if (lastResult.type !== "REVERT") {
            throw new Error("Invalid response. simulateCall must revert")
        }
        const resultData = lastResult.data as Hex

        // Decode the validation result from the revert data
        const { errorName, args } = decodeErrorResult({
            abi: pimlicoSimulationsAbi,
            data: resultData
        })

        if (errorName !== "ValidationResult") {
            let errorCode = ERC7769Errors.SimulateValidation
            const errorMessage = errorName || "Unknown validation error"

            if (errorMessage.includes("AA24")) {
                errorCode = ERC7769Errors.InvalidSignature
            }

            if (errorMessage.includes("AA31")) {
                errorCode = ERC7769Errors.PaymasterDepositTooLow
            }

            throw new RpcError(errorMessage, errorCode)
        }

        const validationResult = args[0] as ValidationResult07

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
                addr: userOp.sender
            },
            factoryInfo:
                userOp.factory && validationResult.factoryInfo
                    ? {
                          ...validationResult.factoryInfo,
                          addr: userOp.factory
                      }
                    : undefined,
            paymasterInfo:
                userOp.paymaster && validationResult.paymasterInfo
                    ? {
                          ...validationResult.paymasterInfo,
                          addr: userOp.paymaster
                      }
                    : undefined,
            aggregatorInfo: validationResult.aggregatorInfo,
            storageMap: {}
        }

        // this.validateStorageAccessList(userOp, res, accessList)

        if (res.returnInfo.accountSigFailed) {
            throw new RpcError(
                "Invalid UserOp signature",
                ERC7769Errors.InvalidSignature
            )
        }

        if (res.returnInfo.paymasterSigFailed) {
            throw new RpcError(
                "Invalid UserOp paymasterData",
                ERC7769Errors.InvalidSignature
            )
        }

        const now = Math.floor(Date.now() / 1000)

        if (res.returnInfo.validAfter > now - 5) {
            throw new RpcError(
                `User operation is not valid yet, validAfter=${res.returnInfo.validAfter}, now=${now}`,
                ERC7769Errors.ExpiresShortly
            )
        }

        if (
            res.returnInfo.validUntil == null ||
            res.returnInfo.validUntil < now + 30
        ) {
            throw new RpcError(
                `UserOperation expires too soon, validUntil=${res.returnInfo.validUntil}, now=${now}`,
                ERC7769Errors.ExpiresShortly
            )
        }

        return [res, tracerResult]
    }
}
