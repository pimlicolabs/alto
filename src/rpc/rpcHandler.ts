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
import type { ApiVersion, BundlerRequest } from "@alto/types"
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
import { getNonceKeyAndSequence, isVersion06, isVersion07 } from "@alto/utils"
import { getContract, zeroAddress } from "viem"
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
            throw new RpcError(
                `EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.config.entrypoints.join(
                    ", "
                )}`,
                ValidationErrors.InvalidFields
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
        userOperation: UserOperation,
        apiVersion: ApiVersion,
        boost: boolean = false
    ): Promise<[boolean, string]> {
        if (
            this.config.legacyTransactions &&
            userOperation.maxFeePerGas !== userOperation.maxPriorityFeePerGas
        ) {
            return [
                false,
                "maxPriorityFeePerGas must equal maxFeePerGas on chains that don't support EIP-1559"
            ]
        }

        if (apiVersion !== "v1" && !this.config.safeMode && !boost) {
            const { lowestMaxFeePerGas, lowestMaxPriorityFeePerGas } =
                await this.gasPriceManager.getLowestValidGasPrices()

            const maxFeePerGas = userOperation.maxFeePerGas
            const maxPriorityFeePerGas = userOperation.maxPriorityFeePerGas

            if (maxFeePerGas < lowestMaxFeePerGas) {
                return [
                    false,
                    `maxFeePerGas must be at least ${lowestMaxFeePerGas} (current maxFeePerGas: ${maxFeePerGas}) - use pimlico_getUserOperationGasPrice to get the current gas price`
                ]
            }

            if (maxPriorityFeePerGas < lowestMaxPriorityFeePerGas) {
                return [
                    false,
                    `maxPriorityFeePerGas must be at least ${lowestMaxPriorityFeePerGas} (current maxPriorityFeePerGas: ${maxPriorityFeePerGas}) - use pimlico_getUserOperationGasPrice to get the current gas price`
                ]
            }
        }

        if (userOperation.verificationGasLimit < 10000n) {
            return [false, "verificationGasLimit must be at least 10000"]
        }

        if (
            userOperation.preVerificationGas === 0n ||
            userOperation.verificationGasLimit === 0n
        ) {
            return [false, "user operation gas limits must be larger than 0"]
        }

        const gasLimits = calculateAA95GasFloor({
            userOps: [userOperation],
            beneficiary: privateKeyToAddress(generatePrivateKey())
        })

        if (gasLimits > this.config.maxGasPerBundle) {
            return [
                false,
                `User operation gas limits exceed the max gas per bundle: ${gasLimits} > ${this.config.maxGasPerBundle}`
            ]
        }

        return [true, ""]
    }

    async validateEip7702Auth({
        userOperation,
        validateSender = false
    }: { userOperation: UserOperation; validateSender?: boolean }): Promise<
        [boolean, string]
    > {
        if (!userOperation.eip7702Auth) {
            return [true, ""]
        }

        if (!this.config.codeOverrideSupport) {
            return [false, "eip7702Auth is not supported on this chain"]
        }

        // Check that auth is valid.
        const delegationDesignator =
            "address" in userOperation.eip7702Auth
                ? userOperation.eip7702Auth.address
                : userOperation.eip7702Auth.contractAddress

        // Fetch onchain data in parallel
        const [sender, nonceOnChain, delegateCode] = await Promise.all([
            validateSender
                ? recoverAuthorizationAddress({
                      authorization: {
                          address: delegationDesignator,
                          chainId: userOperation.eip7702Auth.chainId,
                          nonce: userOperation.eip7702Auth.nonce,
                          r: userOperation.eip7702Auth.r,
                          s: userOperation.eip7702Auth.s,
                          v: userOperation.eip7702Auth.v,
                          yParity: userOperation.eip7702Auth.yParity
                      }
                  })
                : Promise.resolve(userOperation.sender),
            this.config.publicClient.getTransactionCount({
                address: userOperation.sender
            }),
            this.eip7702CodeCache.has(delegationDesignator)
                ? Promise.resolve("has-code")
                : this.config.publicClient.getCode({
                      address: delegationDesignator
                  })
        ])

        if (
            userOperation.eip7702Auth.chainId !== this.config.chainId &&
            userOperation.eip7702Auth.chainId !== 0
        ) {
            return [
                false,
                "Invalid EIP-7702 authorization: The chainId does not match the userOperation sender address"
            ]
        }

        if (![0, 1].includes(userOperation.eip7702Auth.yParity)) {
            return [
                false,
                "Invalid EIP-7702 authorization: The yParity value must be either 0 or 1"
            ]
        }

        if (nonceOnChain !== userOperation.eip7702Auth.nonce) {
            return [
                false,
                "Invalid EIP-7702 authorization: The nonce does not match the userOperation sender address"
            ]
        }

        if (sender !== userOperation.sender) {
            return [
                false,
                "Invalid EIP-7702 authorization: The recovered signer address does not match the userOperation sender address"
            ]
        }

        if (isVersion06(userOperation) && userOperation.initCode !== "0x") {
            return [
                false,
                "Invalid EIP-7702 authorization: UserOperation cannot contain initCode."
            ]
        }

        if (
            isVersion07(userOperation) &&
            userOperation.factory !== "0x7702" &&
            userOperation.factory !== null
        ) {
            return [
                false,
                "Invalid EIP-7702 authorization: UserOperation cannot contain factory that is neither null or 0x7702."
            ]
        }

        // Check delegation designator
        if (delegationDesignator === zeroAddress) {
            return [
                false,
                "Invalid EIP-7702 authorization: Cannot delegate to the zero address."
            ]
        }

        // Use the delegateCode we already got from Promise.all
        const hasCode = this.eip7702CodeCache.has(delegationDesignator)

        if (!hasCode) {
            if (delegateCode === undefined || delegateCode === "0x") {
                return [
                    false,
                    `Invalid EIP-7702 authorization: Delegate ${delegationDesignator} has no code.`
                ]
            }

            this.eip7702CodeCache.set(delegationDesignator, true)
        }

        return [true, ""]
    }

    async getNonceSeq(userOperation: UserOperation, entryPoint: Address) {
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

        const [_, currentNonceSeq] = getNonceKeyAndSequence(getNonceResult)

        return currentNonceSeq
    }
}
