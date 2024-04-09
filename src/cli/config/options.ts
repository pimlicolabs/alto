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
    "user-operation-simulation-contract": {
        description: "Address of the entry point simulations contract",
        type: "string",
        alias: "c",
        require: false
    },
    "executor-private-keys": {
        description: "Private key of the signer",
        type: "string",
        alias: "x",
        require: true
    },
    "utility-private-key": {
        description: "Private key of the utility account",
        type: "string",
        alias: "u",
        require: true
    },
    "max-executors": {
        description:
            "Maximum number of signers to use from the list of signer private keys",
        type: "number",
        require: false
    },
    "min-executor-balance": {
        description: "Minimum balance required for the signer",
        type: "string",
        require: true
    },
    "executor-refill-interval": {
        description: "Interval to refill the signer balance (in ms)",
        type: "number",
        require: true,
        default: 1000 * 60 * 20
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
    "gas-price-floor-percent": {
        description:
            "The minimum percentage of incoming user operation gas prices compared to the gas price used by the bundler to submit bundles",
        type: "number",
        require: true,
        default: 101
    },
    "safe-mode": {
        description: "Enable safe mode (enforcing all ERC-4337 rules)",
        type: "boolean",
        require: true,
        default: true
    },
    "gas-price-expiry": {
        description:
            "Maximum that the gas prices fetched using pimlico_getUserOperationGasPrice will be accepted for (seconds)",
        type: "number",
        require: false,
        default: 10
    }
}

export const compatibilityOptions: CliCommandOptions<ICompatibilityArgsInput> =
    {
        "legacy-transactions": {
            description:
                "Send a legacy transactions instead of an EIP1559 transactions",
            type: "boolean",
            require: false
        },
        "api-version": {
            description: "API version",
            type: "string",
            require: false,
            default: "v1,v2"
        },
        "default-api-version": {
            description: "Default API version",
            type: "string",
            require: false,
            default: "v1"
        },
        "balance-override": {
            description:
                "Override the sender native token balance during estimation",
            type: "boolean",
            require: false
        },
        "local-gas-limit-calculation": {
            description:
                "Calculate the bundle transaction gas limits locally instead of using the RPC gas limit estimation",
            type: "boolean",
            require: false
        },
        "flush-stuck-transactions-during-startup": {
            description:
                "Flush stuck transactions with old nonces during bundler startup",
            type: "boolean",
            require: false
        },
        "fixed-gas-limit-for-estimation": {
            description:
                "Use a fixed value for gas limits during bundle transaction gas limit estimations",
            type: "string",
            require: false
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
        description: "Timeout for the request (in ms)",
        type: "number",
        require: false
    }
}

export const rpcOptions: CliCommandOptions<IRpcArgsInput> = {
    "rpc-url": {
        description: "RPC url to connect to",
        type: "string",
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
        default: "info"
    },
    "public-client-log-level": {
        description: "Log level for the publicClient module",
        type: "string",
        require: false
    },
    "wallet-client-log-level": {
        description: "Log level for the walletClient module",
        type: "string",
        require: false
    },
    "rpc-log-level": {
        description: "Log level for the rpc module",
        type: "string",
        require: false
    },
    "mempool-log-level": {
        description: "Log level for the mempool module",
        type: "string",
        require: false
    },
    "executor-log-level": {
        description: "Log level for the executor module",
        type: "string",
        require: false
    },
    "reputation-manager-log-level": {
        description: "Log level for the executor module",
        type: "string",
        require: false
    },
    "nonce-queuer-log-level": {
        description: "Log level for the executor module",
        type: "string",
        require: false
    }
}

export const debugOptions: CliCommandOptions<IDebugArgsInput> = {
    "bundle-mode": {
        description:
            "Set if the bundler bundle user operations automatically or only when calling debug_bundler_sendBundleNow.",
        type: "string",
        require: true,
        default: "auto"
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
    "tenderly-rpc": {
        description: "RPC url follows the tenderly format",
        type: "boolean",
        require: true,
        default: false
    }
}

export const bundlerCommand: CliCommand<IOptionsInput> = {
    command: "$0",
    describe: "Starts the bundler",
    options: {
        ...bundlerOptions,
        ...compatibilityOptions,
        ...serverOptions,
        ...rpcOptions,
        ...bundleCompressionOptions,
        ...logOptions,
        ...debugOptions
    },
    handler: bundlerHandler
}
