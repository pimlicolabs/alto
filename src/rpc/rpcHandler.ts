import {
    calculateAA95GasFloor,
    type Executor,
    type ExecutorManager
} from "@alto/executor"
import type { EventManager, GasPriceManager } from "@alto/handlers"
import type {
    InterfaceReputationManager,
    Mempool,
    Monitor
} from "@alto/mempool"
import type { ApiVersion, BundlerRequest, StateOverrides } from "@alto/types"
import {
    type Address,
    EntryPointV06Abi,
    EntryPointV07Abi,
    type InterfaceValidator,
    RpcError,
    type UserOperation,
    ValidationErrors
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import {
    calcPreVerificationGas,
    calcVerificationGasAndCallGasLimit,
    deepHexlify,
    getAAError,
    getNonceKeyAndSequence,
    getUserOperationHash,
    isVersion06,
    isVersion07,
    maxBigInt,
    scaleBigIntByPercent
} from "@alto/utils"
import { type Hex, getContract, zeroAddress } from "viem"
import type { AltoConfig } from "../createConfig"
import type { MethodHandler } from "./createMethodHandler"
import { registerHandlers } from "./methods"
import { recoverAuthorizationAddress } from "viem/utils"
import { privateKeyToAddress, generatePrivateKey } from "viem/accounts"

export class RpcHandler {
    public config: AltoConfig
    public validator: InterfaceValidator
    public mempool: Mempool
    public executor: Executor
    public monitor: Monitor
    public executorManager: ExecutorManager
    public reputationManager: InterfaceReputationManager
    public metrics: Metrics
    public eventManager: EventManager
    public gasPriceManager: GasPriceManager
    public logger: Logger

    private methodHandlers: Map<string, MethodHandler>
    private eip7702CodeCache: Map<Address, boolean>

    constructor({
        config,
        validator,
        mempool,
        executor,
        monitor,
        executorManager,
        reputationManager,
        metrics,
        eventManager,
        gasPriceManager
    }: {
        config: AltoConfig
        validator: InterfaceValidator
        mempool: Mempool
        executor: Executor
        monitor: Monitor
        executorManager: ExecutorManager
        reputationManager: InterfaceReputationManager
        metrics: Metrics
        eventManager: EventManager
        gasPriceManager: GasPriceManager
    }) {
        this.config = config
        this.validator = validator
        this.mempool = mempool
        this.executor = executor
        this.monitor = monitor
        this.executorManager = executorManager
        this.reputationManager = reputationManager
        this.metrics = metrics
        this.eventManager = eventManager
        this.gasPriceManager = gasPriceManager

        this.logger = config.getLogger(
            { module: "rpc" },
            {
                level: config.rpcLogLevel || config.logLevel
            }
        )

        this.methodHandlers = new Map()
        this.eip7702CodeCache = new Map()

        registerHandlers(this)
    }

    registerHandler(handler: MethodHandler) {
        this.methodHandlers.set(handler.method, handler)
    }

    async handleMethod(request: BundlerRequest, apiVersion: ApiVersion) {
        const handler = this.methodHandlers.get(request.method)
        if (!handler) {
            throw new RpcError(
                "Method not supported",
                ValidationErrors.InvalidFields
            )
        }

        return await handler.handler({
            rpcHandler: this,
            params: request.params,
            apiVersion
        })
    }

    ensureEntryPointIsSupported(entryPoint: Address) {
        if (!this.config.entrypoints.includes(entryPoint)) {
            throw new Error(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.config.entrypoints.join(
                    ", "
                )}`
            )
        }
    }

    ensureDebugEndpointsAreEnabled(methodName: string) {
        if (!this.config.enableDebugEndpoints) {
            throw new RpcError(
                `${methodName} is only available in development environment`
            )
        }
    }

    async preMempoolChecks(
        opHash: Hex,
        userOperation: UserOperation,
        apiVersion: ApiVersion,
        entryPoint: Address
    ) {
        if (
            this.config.legacyTransactions &&
            userOperation.maxFeePerGas !== userOperation.maxPriorityFeePerGas
        ) {
            const reason =
                "maxPriorityFeePerGas must equal maxFeePerGas on chains that don't support EIP-1559"
            this.eventManager.emitFailedValidation(opHash, reason)
            throw new RpcError(reason)
        }

        if (apiVersion !== "v1" && !this.config.safeMode) {
            await this.gasPriceManager.validateGasPrice({
                maxFeePerGas: userOperation.maxFeePerGas,
                maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas
            })
        }

        if (userOperation.verificationGasLimit < 10000n) {
            const reason = "verificationGasLimit must be at least 10000"
            this.eventManager.emitFailedValidation(opHash, reason)
            throw new RpcError(reason)
        }

        this.logger.trace({ userOperation, entryPoint }, "beginning validation")

        if (
            userOperation.preVerificationGas === 0n ||
            userOperation.verificationGasLimit === 0n
        ) {
            const reason = "user operation gas limits must be larger than 0"
            this.eventManager.emitFailedValidation(opHash, reason)
            throw new RpcError(reason)
        }

        const beneficiary =
            this.config.utilityPrivateKey?.address ||
            privateKeyToAddress(generatePrivateKey())
        const gasLimits = calculateAA95GasFloor({
            userOps: [userOperation],
            beneficiary
        })

        if (gasLimits > this.config.maxGasPerBundle) {
            throw new RpcError(
                `User operation gas limits exceed the max gas per bundle: ${gasLimits} > ${this.config.maxGasPerBundle}`
            )
        }
    }

    // check if we want to bundle userOperation. If yes, add to mempool
    async addToMempoolIfValid(
        userOperation: UserOperation,
        entryPoint: Address,
        apiVersion: ApiVersion
    ): Promise<"added" | "queued"> {
        this.ensureEntryPointIsSupported(entryPoint)

        const opHash = await getUserOperationHash({
            userOperation: userOperation,
            entryPointAddress: entryPoint,
            chainId: this.config.chainId,
            publicClient: this.config.publicClient
        })

        await this.preMempoolChecks(
            opHash,
            userOperation,
            apiVersion,
            entryPoint
        )

        const currentNonceValue = await this.getNonceValue(
            userOperation,
            entryPoint
        )
        const [, userOperationNonceValue] = getNonceKeyAndSequence(
            userOperation.nonce
        )

        if (userOperationNonceValue < currentNonceValue) {
            const reason =
                "UserOperation failed validation with reason: AA25 invalid account nonce"
            this.eventManager.emitFailedValidation(opHash, reason, "AA25")
            throw new RpcError(reason, ValidationErrors.InvalidFields)
        }
        if (userOperationNonceValue > currentNonceValue + 10n) {
            const reason =
                "UserOperation failed validaiton with reason: AA25 invalid account nonce"
            this.eventManager.emitFailedValidation(opHash, reason, "AA25")
            throw new RpcError(reason, ValidationErrors.InvalidFields)
        }

        const queuedUserOperations: UserOperation[] =
            await this.mempool.getQueuedOustandingUserOps({
                userOp: userOperation,
                entryPoint
            })

        if (
            userOperationNonceValue >
            currentNonceValue + BigInt(queuedUserOperations.length)
        ) {
            this.mempool.add(userOperation, entryPoint)
            this.eventManager.emitQueued(opHash)
            return "queued"
        }

        if (this.config.dangerousSkipUserOperationValidation) {
            const [success, errorReason] = await this.mempool.add(
                userOperation,
                entryPoint
            )
            if (!success) {
                this.eventManager.emitFailedValidation(
                    opHash,
                    errorReason,
                    getAAError(errorReason)
                )
                throw new RpcError(errorReason, ValidationErrors.InvalidFields)
            }
            return "added"
        }

        if (apiVersion !== "v1") {
            await this.validator.validatePreVerificationGas({
                userOperation,
                entryPoint
            })
        }
        await this.mempool.checkEntityMultipleRoleViolation(
            entryPoint,
            userOperation
        )

        const validationResult = await this.validator.validateUserOperation({
            userOperation,
            queuedUserOperations,
            entryPoint
        })

        await this.reputationManager.checkReputation(
            userOperation,
            entryPoint,
            validationResult
        )

        await this.mempool.checkEntityMultipleRoleViolation(
            entryPoint,
            userOperation
        )

        const [success, errorReason] = await this.mempool.add(
            userOperation,
            entryPoint,
            validationResult.referencedContracts
        )

        if (!success) {
            this.eventManager.emitFailedValidation(
                opHash,
                errorReason,
                getAAError(errorReason)
            )
            throw new RpcError(errorReason, ValidationErrors.InvalidFields)
        }
        return "added"
    }

    async validateEip7702Auth({
        userOperation,
        validateSender = false
    }: { userOperation: UserOperation; validateSender?: boolean }) {
        if (!userOperation.eip7702Auth) {
            throw new RpcError(
                "UserOperation is missing eip7702Auth",
                ValidationErrors.InvalidFields
            )
        }

        if (!this.config.codeOverrideSupport) {
            throw new RpcError(
                "eip7702Auth is not supported on this chain",
                ValidationErrors.InvalidFields
            )
        }

        // Check that auth is valid.
        const sender = validateSender
            ? await recoverAuthorizationAddress({
                  authorization: {
                      address:
                          "address" in userOperation.eip7702Auth
                              ? userOperation.eip7702Auth.address
                              : userOperation.eip7702Auth.contractAddress,
                      chainId: userOperation.eip7702Auth.chainId,
                      nonce: userOperation.eip7702Auth.nonce,
                      r: userOperation.eip7702Auth.r,
                      s: userOperation.eip7702Auth.s,
                      v: userOperation.eip7702Auth.v,
                      yParity: userOperation.eip7702Auth.yParity
                  }
              })
            : userOperation.sender

        const nonceOnChain = await this.config.publicClient.getTransactionCount(
            {
                address: sender
            }
        )

        if (
            userOperation.eip7702Auth.chainId !== this.config.chainId &&
            userOperation.eip7702Auth.chainId !== 0
        ) {
            throw new RpcError(
                "Invalid EIP-7702 authorization: The chainId does not match the userOperation sender address",
                ValidationErrors.InvalidFields
            )
        }

        if (![0, 1].includes(userOperation.eip7702Auth.yParity)) {
            throw new RpcError(
                "Invalid EIP-7702 authorization: The yParity value must be either 0 or 1",
                ValidationErrors.InvalidFields
            )
        }

        if (nonceOnChain !== userOperation.eip7702Auth.nonce) {
            throw new RpcError(
                "Invalid EIP-7702 authorization: The nonce does not match the userOperation sender address",
                ValidationErrors.SimulateValidation
            )
        }

        if (sender !== userOperation.sender) {
            throw new RpcError(
                "Invalid EIP-7702 authorization: The recovered signer address does not match the userOperation sender address",
                ValidationErrors.InvalidFields
            )
        }

        if (isVersion06(userOperation) && userOperation.initCode !== "0x") {
            throw new RpcError(
                "Invalid EIP-7702 authorization: UserOperation cannot contain initCode.",
                ValidationErrors.InvalidFields
            )
        }

        if (
            isVersion07(userOperation) &&
            userOperation.factory !== "0x7702" &&
            userOperation.factory !== null
        ) {
            throw new RpcError(
                "Invalid EIP-7702 authorization: UserOperation cannot contain factory that is neither null or 0x7702.",
                ValidationErrors.InvalidFields
            )
        }

        // Check delegation designator
        const delegationDesignator =
            "address" in userOperation.eip7702Auth
                ? userOperation.eip7702Auth.address
                : userOperation.eip7702Auth.contractAddress

        if (delegationDesignator === zeroAddress) {
            throw new RpcError(
                "Invalid EIP-7702 authorization: Cannot delegate to the zero address.",
                ValidationErrors.InvalidFields
            )
        }

        const hasCode = this.eip7702CodeCache.has(delegationDesignator)

        if (!hasCode) {
            const delegateCode = await this.config.publicClient.getCode({
                address: delegationDesignator
            })

            if (delegateCode === undefined || delegateCode === "0x") {
                throw new RpcError(
                    `Invalid EIP-7702 authorization: Delegate ${delegationDesignator} has no code.`,
                    ValidationErrors.InvalidFields
                )
            }

            this.eip7702CodeCache.set(delegationDesignator, true)
        }
    }

    async getNonceValue(userOperation: UserOperation, entryPoint: Address) {
        const entryPointContract = getContract({
            address: entryPoint,
            abi: isVersion06(userOperation)
                ? EntryPointV06Abi
                : EntryPointV07Abi,
            client: {
                public: this.config.publicClient
            }
        })

        const [nonceKey] = getNonceKeyAndSequence(userOperation.nonce)

        const getNonceResult = await entryPointContract.read.getNonce(
            [userOperation.sender, nonceKey],
            {
                blockTag: "latest"
            }
        )

        const [_, currentNonceValue] = getNonceKeyAndSequence(getNonceResult)

        return currentNonceValue
    }

    async estimateGas({
        apiVersion,
        userOperation,
        entryPoint,
        stateOverrides
    }: {
        apiVersion: ApiVersion
        userOperation: UserOperation
        entryPoint: Address
        stateOverrides?: StateOverrides
    }) {
        this.ensureEntryPointIsSupported(entryPoint)

        if (userOperation.maxFeePerGas === 0n && !this.config.isGasFreeChain) {
            throw new RpcError(
                "user operation max fee per gas must be larger than 0 during gas estimation"
            )
        }

        // Check if the nonce is valid
        // If the nonce is less than the current nonce, the user operation has already been executed
        // If the nonce is greater than the current nonce, we may have missing user operations in the mempool
        const currentNonceValue = await this.getNonceValue(
            userOperation,
            entryPoint
        )
        const [, userOperationNonceValue] = getNonceKeyAndSequence(
            userOperation.nonce
        )

        let queuedUserOperations: UserOperation[] = []
        if (userOperationNonceValue < currentNonceValue) {
            throw new RpcError(
                "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                ValidationErrors.InvalidFields
            )
        }
        if (userOperationNonceValue > currentNonceValue) {
            // Nonce queues are supported only for v7 user operations
            if (isVersion06(userOperation)) {
                throw new RpcError(
                    "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                    ValidationErrors.InvalidFields
                )
            }

            queuedUserOperations =
                await this.mempool.getQueuedOustandingUserOps({
                    userOp: userOperation,
                    entryPoint
                })

            if (
                userOperationNonceValue >
                currentNonceValue + BigInt(queuedUserOperations.length)
            ) {
                throw new RpcError(
                    "UserOperation reverted during simulation with reason: AA25 invalid account nonce",
                    ValidationErrors.InvalidFields
                )
            }
        }

        // Prepare userOperation for simulation
        const {
            simulationVerificationGasLimit,
            simulationCallGasLimit,
            simulationPaymasterVerificationGasLimit,
            simulationPaymasterPostOpGasLimit
        } = this.config

        const simulationUserOperation = {
            ...userOperation,
            maxFeePerGas: 1n,
            maxPriorityFeePerGas: 1n,
            preVerificationGas: 0n,
            verificationGasLimit: simulationVerificationGasLimit,
            callGasLimit: simulationCallGasLimit
        }

        if (isVersion07(simulationUserOperation)) {
            simulationUserOperation.paymasterVerificationGasLimit =
                simulationPaymasterVerificationGasLimit
            simulationUserOperation.paymasterPostOpGasLimit =
                simulationPaymasterPostOpGasLimit
        }

        // This is necessary because entryPoint pays
        // min(maxFeePerGas, baseFee + maxPriorityFeePerGas) for the verification
        // Since we don't want our estimations to depend upon baseFee, we set
        // maxFeePerGas to maxPriorityFeePerGas
        simulationUserOperation.maxPriorityFeePerGas =
            simulationUserOperation.maxFeePerGas

        const executionResult = await this.validator.getExecutionResult({
            userOperation: simulationUserOperation,
            entryPoint,
            queuedUserOperations,
            stateOverrides: deepHexlify(stateOverrides)
        })

        let {
            verificationGasLimit,
            callGasLimit,
            paymasterVerificationGasLimit
        } = calcVerificationGasAndCallGasLimit(
            simulationUserOperation,
            executionResult.data.executionResult,
            executionResult.data
        )

        let paymasterPostOpGasLimit = 0n

        if (
            !paymasterVerificationGasLimit &&
            isVersion07(simulationUserOperation) &&
            simulationUserOperation.paymaster !== null &&
            "paymasterVerificationGasLimit" in
                executionResult.data.executionResult
        ) {
            paymasterVerificationGasLimit =
                executionResult.data.executionResult
                    .paymasterVerificationGasLimit || 1n

            paymasterVerificationGasLimit = scaleBigIntByPercent(
                paymasterVerificationGasLimit,
                this.config.paymasterGasLimitMultiplier
            )
        }

        if (
            isVersion07(simulationUserOperation) &&
            simulationUserOperation.paymaster !== null &&
            "paymasterPostOpGasLimit" in executionResult.data.executionResult
        ) {
            paymasterPostOpGasLimit =
                executionResult.data.executionResult.paymasterPostOpGasLimit ||
                1n

            const userOperationPaymasterPostOpGasLimit =
                "paymasterPostOpGasLimit" in userOperation
                    ? userOperation.paymasterPostOpGasLimit ?? 1n
                    : 1n

            paymasterPostOpGasLimit = maxBigInt(
                userOperationPaymasterPostOpGasLimit,
                scaleBigIntByPercent(
                    paymasterPostOpGasLimit,
                    this.config.paymasterGasLimitMultiplier
                )
            )
        }

        if (simulationUserOperation.callData === "0x") {
            callGasLimit = 0n
        }

        if (isVersion06(simulationUserOperation)) {
            callGasLimit = scaleBigIntByPercent(
                callGasLimit,
                this.config.v6CallGasLimitMultiplier
            )
            verificationGasLimit = scaleBigIntByPercent(
                verificationGasLimit,
                this.config.v6VerificationGasLimitMultiplier
            )
        }

        if (isVersion07(simulationUserOperation)) {
            verificationGasLimit = scaleBigIntByPercent(
                verificationGasLimit,
                this.config.v7VerificationGasLimitMultiplier
            )
            paymasterVerificationGasLimit = scaleBigIntByPercent(
                paymasterVerificationGasLimit,
                this.config.v7PaymasterVerificationGasLimitMultiplier
            )
            callGasLimit = scaleBigIntByPercent(
                callGasLimit,
                this.config.v7CallGasLimitMultiplier
            )
            paymasterPostOpGasLimit = scaleBigIntByPercent(
                paymasterPostOpGasLimit,
                this.config.v7PaymasterPostOpGasLimitMultiplier
            )
        }

        let preVerificationGas = await calcPreVerificationGas({
            config: this.config,
            userOperation: {
                ...userOperation,
                callGasLimit, // use actual callGasLimit
                verificationGasLimit, // use actual verificationGasLimit
                paymasterPostOpGasLimit, // use actual paymasterPostOpGasLimit
                paymasterVerificationGasLimit // use actual paymasterVerificationGasLimit
            },
            entryPoint,
            gasPriceManager: this.gasPriceManager,
            validate: false
        })
        preVerificationGas = scaleBigIntByPercent(preVerificationGas, 110n)

        // Check if userOperation passes without estimation balance overrides
        await this.validator.validateHandleOp({
            userOperation: {
                ...userOperation,
                preVerificationGas,
                verificationGasLimit,
                callGasLimit,
                paymasterVerificationGasLimit,
                paymasterPostOpGasLimit
            },
            entryPoint,
            queuedUserOperations,
            stateOverrides: deepHexlify(stateOverrides)
        })

        if (isVersion07(simulationUserOperation)) {
            return {
                preVerificationGas,
                verificationGasLimit,
                callGasLimit,
                paymasterVerificationGasLimit,
                paymasterPostOpGasLimit
            }
        }

        if (apiVersion === "v2") {
            return {
                preVerificationGas,
                verificationGasLimit,
                callGasLimit
            }
        }

        return {
            preVerificationGas,
            verificationGas: verificationGasLimit,
            verificationGasLimit,
            callGasLimit
        }
    }
}
