import { bundlerHandler } from "../handler"
import type { CliCommand, CliCommandOptions } from "../util"
import type {
    IBundleCompressionArgsInput,
    IBundlerArgsInput,
    ICompatibilityArgsInput,
    IDebugArgsInput,
    ILogArgsInput,
    IOptionsInput,
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
    "entrypoint-simulation-contract": {
        description: "Address of the EntryPoint simulations contract",
        type: "string",
        alias: "c",
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
    "max-bundle-wait": {
        description: "Maximum time to wait for a bundle to be submitted (ms)",
        type: "number",
        require: true,
        default: 1000
    },
    "max-bundle-size": {
        description:
            "Maximum number of operations allowed in the mempool before a bundle is submitted",
        type: "number",
        require: true,
        default: 10
    },
    "safe-mode": {
        description: "Enable safe mode (enforcing all ERC-4337 rules)",
        type: "boolean",
        require: true,
        default: true
    },
    "gas-price-floor-percent": {
        description:
            "The minimum percentage of incoming user operation gas prices compared to the gas price used by the bundler to submit bundles",
        type: "number",
        require: true,
        default: 101
    },
    "gas-price-expiry": {
        description:
            "Maximum that the gas prices fetched using pimlico_getUserOperationGasPrice will be accepted for (seconds)",
        type: "number",
        require: false,
        default: 10
    },
    "gas-price-multipliers": {
        description:
            "Amount to multiply the gas prices fetched using pimlico_getUserOperationGasPrice (format: slow,standard,fast)",
        type: "string",
        require: false,
        default: "105,110,115"
    }
}

export const compatibilityOptions: CliCommandOptions<ICompatibilityArgsInput> =
    {
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
        "local-gas-limit-calculation": {
            description:
                "Calculate the bundle transaction gas limits locally instead of using the RPC gas limit estimation",
            type: "boolean",
            require: true,
            default: false
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
        "default-api-version": {
            description: "Default API version",
            type: "string",
            require: false,
            default: "v1"
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
        description: "Maximum payload size for websocket messages in bytes (default to 1MB)",
        type: "number",
        require: false
    },
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
    "polling-interval": {
        description: "Polling interval for querying for new blocks (ms)",
        type: "number",
        require: true,
        default: 1000
    },
    "max-block-range": {
        description: "Max block range for getLogs calls",
        type: "number",
        require: false
    }
}

export const bundleCompressionOptions: CliCommandOptions<IBundleCompressionArgsInput> =
    {
        "bundle-bulker-address": {
            description: "Address of the BundleBulker contract",
            type: "string",
            require: false
        },
        "per-op-inflator-address": {
            description: "Address of the PerOpInflator contract",
            type: "string",
            require: false
        }
    }

export const logOptions: CliCommandOptions<ILogArgsInput> = {
    json: {
        description: "Log in JSON format",
        type: "boolean",
        require: true,
        default: false
    },
    "network-name": {
        description: "Name of the network (used for metrics)",
        type: "string",
        require: true,
        default: "localhost"
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
    tenderly: {
        description: "RPC url follows the tenderly format",
        type: "boolean",
        require: true,
        default: false
    }
}

export const bundlerCommand: CliCommand<IOptionsInput> = {
    command: "$0",
    describe: "Starts the bundler",
    handler: bundlerHandler
}
