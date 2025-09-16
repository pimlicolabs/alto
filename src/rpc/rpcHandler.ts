import {
    type Executor,
    type ExecutorManager,
    calculateAA95GasFloor
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
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"
import { recoverAuthorizationAddress } from "viem/utils"
import type { AltoConfig } from "../createConfig"
import type { BundleManager } from "../executor/bundleManager"
import type { MethodHandler } from "./createMethodHandler"
import { registerHandlers } from "./methods"

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
    public bundleManager: BundleManager
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
        bundleManager,
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
        bundleManager: BundleManager
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
        this.bundleManager = bundleManager

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
        userOp: UserOperation,
        apiVersion: ApiVersion,
        boost = false
    ): Promise<[boolean, string]> {
        if (
            this.config.legacyTransactions &&
            userOp.maxFeePerGas !== userOp.maxPriorityFeePerGas
        ) {
            return [
                false,
                "maxPriorityFeePerGas must equal maxFeePerGas on chains that don't support EIP-1559"
            ]
        }

        if (apiVersion !== "v1" && !this.config.safeMode && !boost) {
            const { lowestMaxFeePerGas, lowestMaxPriorityFeePerGas } =
                await this.gasPriceManager.getLowestValidGasPrices()

            const maxFeePerGas = userOp.maxFeePerGas
            const maxPriorityFeePerGas = userOp.maxPriorityFeePerGas

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

        if (userOp.verificationGasLimit < 10000n) {
            return [false, "verificationGasLimit must be at least 10000"]
        }

        if (!boost && userOp.preVerificationGas === 0n) {
            return [
                false,
                "userOperation preVerification gas must be larger than 0"
            ]
        }

        if (userOp.verificationGasLimit === 0n) {
            return [
                false,
                "userOperation verification gas limit must be larger than 0"
            ]
        }

        const gasLimits = calculateAA95GasFloor({
            userOps: [userOp],
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
        userOp,
        validateSender = false
    }: { userOp: UserOperation; validateSender?: boolean }): Promise<
        [boolean, string]
    > {
        if (!userOp.eip7702Auth) {
            return [true, ""]
        }

        if (!this.config.codeOverrideSupport) {
            return [false, "eip7702Auth is not supported on this chain"]
        }

        // Check that auth is valid.
        const delegationDesignator =
            "address" in userOp.eip7702Auth
                ? userOp.eip7702Auth.address
                : userOp.eip7702Auth.contractAddress

        // Fetch onchain data in parallel
        const [sender, nonceOnChain, delegateCode] = await Promise.all([
            validateSender
                ? recoverAuthorizationAddress({
                      authorization: {
                          address: delegationDesignator,
                          chainId: userOp.eip7702Auth.chainId,
                          nonce: userOp.eip7702Auth.nonce,
                          r: userOp.eip7702Auth.r,
                          s: userOp.eip7702Auth.s,
                          v: userOp.eip7702Auth.v,
                          yParity: userOp.eip7702Auth.yParity
                      }
                  })
                : Promise.resolve(userOp.sender),
            this.config.publicClient.getTransactionCount({
                address: userOp.sender
            }),
            this.eip7702CodeCache.has(delegationDesignator)
                ? Promise.resolve("has-code")
                : this.config.publicClient.getCode({
                      address: delegationDesignator
                  })
        ])

        if (
            userOp.eip7702Auth.chainId !== this.config.chainId &&
            userOp.eip7702Auth.chainId !== 0
        ) {
            return [
                false,
                "Invalid EIP-7702 authorization: The chainId does not match the userOperation sender address"
            ]
        }

        if (![0, 1].includes(userOp.eip7702Auth.yParity)) {
            return [
                false,
                "Invalid EIP-7702 authorization: The yParity value must be either 0 or 1"
            ]
        }

        if (nonceOnChain !== userOp.eip7702Auth.nonce) {
            return [
                false,
                "Invalid EIP-7702 authorization: The nonce does not match the userOperation sender address"
            ]
        }

        if (sender !== userOp.sender) {
            return [
                false,
                "Invalid EIP-7702 authorization: The recovered signer address does not match the userOperation sender address"
            ]
        }

        if (isVersion06(userOp) && userOp.initCode !== "0x") {
            return [
                false,
                "Invalid EIP-7702 authorization: UserOperation cannot contain initCode."
            ]
        }

        if (
            isVersion07(userOp) &&
            userOp.factory !== "0x7702" &&
            userOp.factory !== null
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

    async getNonceSeq(userOp: UserOperation, entryPoint: Address) {
        const entryPointContract = getContract({
            address: entryPoint,
            abi: isVersion06(userOp) ? EntryPointV06Abi : EntryPointV07Abi,
            client: {
                public: this.config.publicClient
            }
        })

        const [nonceKey] = getNonceKeyAndSequence(userOp.nonce)

        const getNonceResult = await entryPointContract.read.getNonce(
            [userOp.sender, nonceKey],
            {
                blockTag: "latest"
            }
        )

        const [_, currentNonceSeq] = getNonceKeyAndSequence(getNonceResult)

        return currentNonceSeq
    }
}
