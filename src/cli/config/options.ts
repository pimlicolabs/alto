import { bundlerHandler } from "../handler"
import type { CliCommand, CliCommandOptions } from "../util"
import type {
    IBundlerArgsInput,
    ICompatibilityArgsInput,
    IDebugArgsInput,
    IExecutorArgsInput,
    IGasEstimationArgsInput,
    ILogArgsInput,
    IMempoolArgsInput,
    IOptionsInput,
    IRedisArgsInput,
    IRpcArgsInput,
    IServerArgsInput
} from "./bundler"

export const bundlerOptions: CliCommandOptions<IBundlerArgsInput> = {
    entrypoints: {
        description: "EntryPoint contract addresses split by commas",
        type: "string",
        alias: "e",
        require: true
    },
    "deterministic-deployer-address": {
        description: "Address of the deterministic deployer contract",
        type: "string",
        alias: "d",
        require: false,
        default: "0x4e59b44847b379578588920ca78fbf26c0b4956c"
    },
    "min-entity-stake": {
        description: "Minimum stake required for a relay (in 10e18)",
        type: "number",
        require: true,
        default: 1
    },
    "min-entity-unstake-delay": {
        description: "Minimum unstake delay (seconds)",
        type: "number",
        require: true,
        default: 1
    },
    "safe-mode": {
        description: "Enable safe mode (enforcing all ERC-4337 rules)",
        type: "boolean",
        require: true,
        default: true
    },
    "gas-price-bump": {
        description: "Amount to multiply the gas prices fetched from the node",
        type: "string",
        require: false,
        default: "100"
    },
    "gas-price-expiry": {
        description:
            "Maximum that the gas prices fetched using pimlico_getUserOperationGasPrice will be accepted for (seconds)",
        type: "number",
        require: false,
        default: 20
    },
    "gas-price-multipliers": {
        description:
            "Amount to multiply the gas prices fetched using pimlico_getUserOperationGasPrice (format: slow,standard,fast)",
        type: "string",
        require: false,
        default: "100,100,100"
    },
    "gas-price-refresh-interval": {
        description:
            "How to often to refresh the gas prices (seconds). If 0, then gas prices are refreshed on every request",
        type: "number",
        require: false,
        default: 0
    },
    "mempool-max-parallel-ops": {
        description:
            "Maximum amount of parallel user ops to keep in the meempool (same sender, different nonce keys)",
        type: "number",
        require: false,
        default: 10
    },
    "mempool-max-queued-ops": {
        description:
            "Maximum amount of sequential user ops to keep in the mempool (same sender and nonce key, different nonce values)",
        type: "number",
        require: false,
        default: 0
    },
    "enforce-unique-senders-per-bundle": {
        description:
            "Include user ops with the same sender in the single bundle",
        type: "boolean",
        require: false,
        default: true
    },
    "max-gas-per-bundle": {
        description: "Maximum amount of gas per bundle",
        type: "string",
        require: false,
        default: "20000000"
    },
    "rpc-methods": {
        description: "Supported RPC methods split by commas",
        type: "string",
        require: false,
        default: null
    },
    "enable-instant-bundling-endpoint": {
        description:
            "Should the bundler enable the pimlico_sendUserOperationNow endpoint",
        type: "boolean",
        default: false
    },
    "rpc-gas-estimate": {
        description:
            "Should the bundler make a eth_estimateGas call to estimate the handleOps gasLimit",
        type: "boolean",
        default: false
    },
    "flashblocks-preconfirmation-time": {
        description: "Time in milliseconds for preconfirmation (flashblocks)",
        type: "number",
        default: undefined
    }
}

export const redisOptions: CliCommandOptions<IRedisArgsInput> = {
    "enable-horizontal-scaling": {
        description: "Enable horizontal scaling using Redis",
        type: "boolean",
        require: false,
        default: false
    },
    "enable-redis-receipt-cache": {
        description: "Enable Redis for user operation receipt cache",
        type: "boolean",
        require: false,
        default: false
    },
    "redis-key-prefix": {
        description: "Redis key prefix for all Redis data structures",
        type: "string",
        require: false,
        default: "alto"
    },
    "redis-endpoint": {
        description:
            "Common Redis connection URL for all Redis operations (except userOp events)",
        type: "string",
        require: false
    },
    "redis-events-queue-endpoint": {
        description: "Redis endpoint for userOp events queue",
        type: "string",
        require: false
    },
    "redis-events-queue-name": {
        description: "Queue name for userOp events",
        type: "string",
        require: false,
        default: "UserOperationStatusBullEventsQueue"
    }
}

export const mempoolOptions: CliCommandOptions<IMempoolArgsInput> = {
    "restoration-queue-timeout": {
        description:
            "Timeout in milliseconds for listening to mempool restoration queue (default: 30 minutes)",
        type: "number",
        require: false,
        default: 30 * 60 * 1000
    },
    "mempool-max-parallel-ops": {
        description:
            "Maximum amount of parallel user ops to keep in the mempool (same sender, different nonce keys)",
        type: "number",
        require: false,
        default: 10
    },
    "mempool-max-queued-ops": {
        description:
            "Maximum amount of sequential user ops to keep in the mempool (same sender and nonce key, different nonce values)",
        type: "number",
        require: false,
        default: 0
    },
    "mempool-pop-batch-size": {
        description:
            "Number of user operations to pop from the mempool at once for bundling",
        type: "number",
        require: false,
        default: 10
    },
    "enforce-unique-senders-per-bundle": {
        description:
            "Include user ops with the same sender in the single bundle",
        type: "boolean",
        require: false,
        default: true
    },
    "ignored-paymasters": {
        description:
            "Comma-separated list of paymaster addresses to ignore when checking for queued user operations",
        type: "string",
        require: false
    }
}

export const gasEstimationOptions: CliCommandOptions<IGasEstimationArgsInput> =
    {
        "pimlico-simulation-contract": {
            description: "Address of the Pimlico simulation contract",
            type: "string",
            require: false
        },
        "entrypoint-simulation-contract-v7": {
            description:
                "Address of the EntryPoint simulations contract for v0.7",
            type: "string",
            alias: "c",
            require: false
        },
        "entrypoint-simulation-contract-v8": {
            description:
                "Address of the EntryPoint simulations contract for v0.8",
            type: "string",
            alias: "c",
            require: false
        },
        "binary-search-tolerance-delta": {
            description:
                "Defines the threshold for when to stop the gas estimation binary search",
            type: "string",
            require: false,
            default: "10000"
        },
        "binary-search-gas-allowance": {
            description:
                "Added to the initial minimum gas to determine the upper bound of the binary search",
            type: "string",
            require: false,
            default: "30000000"
        },
        "v6-call-gas-limit-multiplier": {
            description:
                "Amount to multiply the callGasLimits fetched from simulations for v6 userOperations",
            type: "string",
            require: true,
            default: "100"
        },
        "v6-verification-gas-limit-multiplier": {
            description:
                "Amount to multiply the verificationGasLimit fetched from simulations for v6 userOperations",
            type: "string",
            require: true,
            default: "100"
        },
        "v6-pre-verification-gas-limit-multiplier": {
            description:
                "Amount to multiply the preVerificationGas limits fetched from simulations for v6 userOperations",
            type: "string",
            require: true,
            default: "110"
        },
        "v7-call-gas-limit-multiplier": {
            description:
                "Amount to multiply the callGasLimit fetched from simulations for v7 userOperations",
            type: "string",
            require: true,
            default: "100"
        },
        "v7-verification-gas-limit-multiplier": {
            description:
                "Amount to multiply the verificationGasLimits fetched from simulations for v7 userOperations",
            type: "string",
            require: true,
            default: "130"
        },
        "v7-paymaster-verification-gas-limit-multiplier": {
            description:
                "Amount to multiply the paymasterVerificationGas limits fetched from simulations for v7 userOperations",
            type: "string",
            require: true,
            default: "130"
        },
        "v7-paymaster-post-op-gas-limit-multiplier": {
            description:
                "Amount to multiply the paymasterPostOp limits fetched from simulations for v7 userOperations",
            type: "string",
            require: true,
            default: "120"
        },
        "v7-pre-verification-gas-limit-multiplier": {
            description:
                "Amount to multiply the preVerificationGas limits fetched from simulations for v7 userOperations",
            type: "string",
            require: true,
            default: "110"
        },
        "simulation-call-gas-limit": {
            description:
                "UserOperation's callGasLimit used during gas estimation simulations",
            type: "string",
            require: true,
            default: "10000000"
        },
        "simulation-verification-gas-limit": {
            description:
                "UserOperation's verificationGasLimit used during gas estimation simulations",
            type: "string",
            require: true,
            default: "10000000"
        },
        "simulation-paymaster-verification-gas-limit": {
            description:
                "UserOperation's paymasterVerificationGasLimit used during gas estimation simulations",
            type: "string",
            require: true,
            default: "5000000"
        },
        "simulation-paymaster-post-op-gas-limit": {
            description:
                "UserOperation's paymasterPostOpGasLimit used during gas estimation simulations",
            type: "string",
            require: true,
            default: "2000000"
        },
        "eth-call-sender-address": {
            description:
                "For permissioned chains, eth_call simulations require a whitelisted address as the sender",
            type: "string"
        },
        "split-simulation-calls": {
            description:
                "Should the bundler split estimation simulations into smaller calls.",
            type: "boolean",
            default: false
        },
        "call-gas-limit-floor": {
            description:
                "Minimum callGasLimit to enforce when there are queued user operations",
            type: "string",
            require: false,
            default: "50000"
        }
    }

export const executorOptions: CliCommandOptions<IExecutorArgsInput> = {
    "max-bundle-count": {
        description:
            "Maximum number of bundles when calling mempool's process function",
        type: "number",
        require: false
    },
    "resubmit-stuck-timeout": {
        description:
            "Amount of time before retrying a failed userOperation (in ms)",
        type: "number",
        require: true,
        default: 10_000
    },
    "resubmit-multiplier-ceiling": {
        description:
            "Maximum multiplier for gasPrice when resubmitting transactions",
        type: "string",
        require: false,
        default: "300"
    },
    "gas-limit-rounding-multiple": {
        description:
            "Value to round transaction gas limit to the nearest multiple of",
        type: "string",
        require: false,
        default: "4337"
    },
    "refilling-wallets": {
        description: "Enable refilling wallets",
        type: "boolean",
        require: false,
        default: true
    },
    "executor-gas-multiplier": {
        description: "Amount to scale the gas estimations used for bundling",
        type: "string",
        default: "100"
    },
    "refill-helper-contract": {
        description: "Address of the Executor refill helper contract",
        type: "string",
        require: false
    },
    "executor-private-keys": {
        description: "Private keys of the executor accounts split by commas",
        type: "string",
        alias: "x",
        require: true
    },
    "utility-private-key": {
        description: "Private key of the utility account",
        type: "string",
        alias: "u",
        require: false
    },
    "utility-wallet-monitor": {
        description: "Either to enable utility wallet monitor or not",
        type: "boolean",
        default: true
    },
    "utility-wallet-monitor-interval": {
        description: "Interval for checking utility wallet balance",
        type: "number",
        default: 15 * 1000 // 15 seconds
    },
    "max-executors": {
        description:
            "Maximum number of executor accounts to use from the list of executor private keys",
        type: "number",
        require: false
    },
    "min-executor-balance": {
        description:
            "Minimum balance required for each executor account (below which the utility account will refill)",
        type: "string"
    },
    "executor-refill-interval": {
        description: "Interval to refill the signer balance (seconds)",
        type: "number",
        require: true,
        default: 60 * 20
    },
    "transaction-underpriced-multiplier": {
        description:
            "GasPrice Multiplier to use when retrying in event of Transaction Underpriced error",
        type: "string",
        require: false,
        default: "150"
    },
    "send-handle-ops-retry-count": {
        description:
            "Number of times to retry calling sendHandleOps transaction",
        type: "number",
        require: false,
        default: 3
    },
    "bundler-initial-commission": {
        description:
            "Initial commission percentage the bundler retains (10 = retain 10% of margin)",
        type: "string",
        require: false,
        default: "10"
    },
    "binary-search-max-retries": {
        description:
            "Maximum number of retries for binary search operations during gas estimation",
        type: "number",
        require: false,
        default: 3
    },
    "private-endpoint-submission-attempts": {
        description:
            "Number of submission attempts to use private RPC endpoint before switching to public",
        type: "number",
        require: false,
        default: 3
    }
}

export const compatibilityOptions: CliCommandOptions<ICompatibilityArgsInput> =
    {
        "chain-type": {
            description:
                "Indicates what type of chain the bundler is running on",
            type: "string",
            choices: [
                "default",
                "op-stack",
                "arbitrum",
                "hedera",
                "mantle",
                "etherlink",
                "monad"
            ],
            default: "default"
        },
        "legacy-transactions": {
            description:
                "Send a legacy transactions instead of an EIP-1559 transactions",
            type: "boolean",
            require: true,
            default: false
        },
        "balance-override": {
            description:
                "Override the sender native token balance during estimation",
            type: "boolean",
            require: true,
            default: true
        },
        "flush-stuck-transactions-during-startup": {
            description:
                "Flush stuck transactions with old nonces during bundler startup",
            type: "boolean",
            require: true,
            default: false
        },
        "fixed-gas-limit-for-estimation": {
            description:
                "Use a fixed value for gas limits during bundle transaction gas limit estimations",
            type: "string",
            require: false
        },
        "api-version": {
            description:
                "API version (used for internal Pimlico versioning compatibility)",
            type: "string",
            require: true,
            default: "v1,v2"
        },
        "is-gas-free-chain": {
            description:
                "Indicates if the chain uses 0 for maxFee/maxPriorityFee",
            type: "boolean",
            default: false
        },
        "default-api-version": {
            description: "Default API version",
            type: "string",
            require: false,
            default: "v1"
        },
        "floor-max-fee-per-gas": {
            description: "Minimum value for maxFeePerGas to enforce (in gwei)",
            type: "string",
            require: false
        },
        "floor-max-priority-fee-per-gas": {
            description:
                "Minimum value for maxPriorityFeePerGas to enforce (in gwei)",
            type: "string",
            require: false
        },
        "static-max-priority-fee-per-gas": {
            description:
                "Static maxPriorityFeePerGas value (in gwei) instead of RPC estimation",
            type: "string",
            require: false
        },
        "supports-eip7623": {
            description:
                "Whether the chain supports EIP-7623 (Increase calldata cost to reduce maximum block size)",
            type: "boolean",
            require: false,
            default: false
        },
        "arbitrum-gas-bid-multiplier": {
            description:
                "Multiplier for gas bid on Arbitrum networks to account for baseFee fluctuations",
            type: "string",
            require: false,
            default: "5"
        },
        "monad-reserve-balance": {
            description:
                "Minimum balance (in wei) that must be reserved for Monad chain user operations without paymasters",
            type: "string",
            require: false,
            default: "10000000000000000000"
        }
    }

export const serverOptions: CliCommandOptions<IServerArgsInput> = {
    port: {
        description: "Port to listen on",
        type: "number",
        require: true,
        default: 3000
    },
    timeout: {
        description: "Timeout for incoming requests (in ms)",
        type: "number",
        require: false
    },
    "websocket-max-payload-size": {
        description:
            "Maximum payload size for websocket messages in bytes (default to 1MB)",
        type: "number",
        require: false
    },
    websocket: {
        description: "Enable websocket server",
        type: "boolean",
        require: false
    }
}

export const rpcOptions: CliCommandOptions<IRpcArgsInput> = {
    "rpc-url": {
        description: "RPC url to connect to",
        type: "string",
        alias: "r",
        require: true
    },
    "send-transaction-rpc-url": {
        description: "RPC url to send transactions to (e.g. flashbots relay)",
        type: "string",
        require: false
    },
    "block-time": {
        description: "Block time for the chain (ms)",
        type: "number",
        require: true,
        default: 1000
    },
    "max-block-wait-count": {
        description: "Max block wait count for frontrun check",
        type: "number",
        require: false,
        default: 2
    },
    "max-block-range": {
        description: "Max block range for getLogs calls",
        type: "number",
        default: 2000,
        require: false
    },
    "block-number-cache-ttl": {
        description: "TTL for the block number cache in milliseconds",
        type: "number",
        default: 15000, // Default to 1 minute
        require: false
    },
    "block-tag-support": {
        description:
            "Disable sending block tag when sending eth_estimateGas call",
        type: "boolean",
        require: false,
        default: true
    },
    "code-override-support": {
        description: "Does the RPC support code overrides",
        type: "boolean",
        require: false,
        default: true
    }
}

export const logOptions: CliCommandOptions<ILogArgsInput> = {
    json: {
        description: "Log in JSON format",
        type: "boolean",
        require: true,
        default: false
    },
    "log-level": {
        description: "Default log level",
        type: "string",
        require: true,
        choices: ["trace", "debug", "info", "warn", "error", "fatal"],
        default: "info"
    },
    "public-client-log-level": {
        description: "Log level for the publicClient module",
        type: "string",
        choices: ["trace", "debug", "info", "warn", "error", "fatal"],
        require: false
    },
    "wallet-client-log-level": {
        description: "Log level for the walletClient module",
        type: "string",
        choices: ["trace", "debug", "info", "warn", "error", "fatal"],
        require: false
    },
    "rpc-log-level": {
        description: "Log level for the rpc module",
        type: "string",
        choices: ["trace", "debug", "info", "warn", "error", "fatal"],
        require: false
    },
    "mempool-log-level": {
        description: "Log level for the mempool module",
        type: "string",
        choices: ["trace", "debug", "info", "warn", "error", "fatal"],
        require: false
    },
    "executor-log-level": {
        description: "Log level for the executor module",
        type: "string",
        choices: ["trace", "debug", "info", "warn", "error", "fatal"],
        require: false
    },
    "reputation-manager-log-level": {
        description: "Log level for the executor module",
        type: "string",
        choices: ["trace", "debug", "info", "warn", "error", "fatal"],
        require: false
    },
    "nonce-queuer-log-level": {
        description: "Log level for the executor module",
        type: "string",
        choices: ["trace", "debug", "info", "warn", "error", "fatal"],
        require: false
    }
}

export const debugOptions: CliCommandOptions<IDebugArgsInput> = {
    "bundle-mode": {
        description:
            "Set if the bundler bundle user operations automatically or only when calling debug_bundler_sendBundleNow.",
        type: "string",
        require: true,
        default: "auto",
        choices: ["auto", "manual"]
    },
    "min-bundle-interval": {
        description:
            "Minimum interval in milliseconds between bundling operations in auto mode",
        type: "number",
        require: false,
        default: 100
    },
    "max-bundle-interval": {
        description:
            "Maximum interval in milliseconds between bundling operations in auto mode",
        type: "number",
        require: false,
        default: 1000
    },
    "enable-debug-endpoints": {
        description: "Enable debug endpoints",
        type: "boolean",
        require: true,
        default: false
    },
    "expiration-check": {
        description: "Should the node make expiration checks",
        type: "boolean",
        require: true,
        default: true
    },
    "dangerous-skip-user-operation-validation": {
        description: "Skip user operation validation, use with caution",
        type: "boolean",
        require: true,
        default: false
    },
    "deploy-simulations-contract": {
        description:
            "Should the bundler deploy the simulations contract on startup",
        type: "boolean",
        require: true,
        default: true
    }
}

export const bundlerCommand: CliCommand<IOptionsInput> = {
    command: "$0",
    describe: "Starts the bundler",
    handler: bundlerHandler
}
