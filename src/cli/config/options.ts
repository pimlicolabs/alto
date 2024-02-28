import { bundlerHandler } from "../handler"
import type { CliCommand, CliCommandOptions } from "../util"
import type { IBundlerArgsInput } from "./bundler"

export const bundlerOptions: CliCommandOptions<IBundlerArgsInput> = {
    networkName: {
        description: "Name of the network (used for metrics)",
        type: "string",
        require: true
    },
    entryPoint: {
        description: "EntryPoint contract addresses split by commas",
        type: "string",
        require: true
    },
    entryPointSimulationsAddress: {
        description: "Address of the entry point simulations contract",
        type: "string",
        require: false
    },
    signerPrivateKeys: {
        description: "Private key of the signer",
        type: "string",
        require: true
    },
    signerPrivateKeysExtra: {
        description: "Private key of the signer",
        type: "string"
    },
    utilityPrivateKey: {
        description: "Private key of the utility account",
        type: "string",
        require: true
    },
    maxSigners: {
        description:
            "Maximum number of signers to use from the list of signer private keys",
        type: "number"
    },
    minBalance: {
        description: "Minimum balance required for the signer",
        type: "string",
        require: true
    },
    perOpInflatorAddress: {
        description: "Address of the PerOpInflator contract",
        type: "string",
        require: false
    },
    bundleBulkerAddress: {
        description: "Address of the BundleBulker contract",
        type: "string",
        require: false
    },
    refillInterval: {
        description: "Interval to refill the signer balance (in ms)",
        type: "number",
        require: true,
        default: 1000 * 60 * 20
    },
    requestTimeout: {
        description: "Timeout for the request (in ms)",
        type: "number",
        require: false
    },
    rpcUrl: {
        description: "RPC url to connect to",
        type: "string",
        require: true
    },
    executionRpcUrl: {
        description: "RPC url to send transactions to",
        type: "string",
        require: false
    },
    minStake: {
        description: "Minimum stake required for a relay (in 10e18)",
        type: "number",
        require: true,
        default: 1
    },
    minUnstakeDelay: {
        description: "Minimum unstake delay",
        type: "number",
        require: true,
        default: 1
    },
    maxBundleWaitTime: {
        description: "Maximum time to wait for a bundle to be submitted",
        type: "number",
        require: true,
        default: 3
    },
    maxBundleSize: {
        description:
            "Maximum number of operations in mempool before a bundle is submitted",
        type: "number",
        require: true,
        default: 3
    },
    port: {
        description: "Port to listen on",
        type: "number",
        require: true,
        default: 3000
    },
    pollingInterval: {
        description: "Polling interval for the executor module (ms)",
        type: "number",
        require: true,
        default: 1000
    },
    logLevel: {
        description: "Default log level",
        type: "string",
        require: true,
        default: "debug"
    },
    publicClientLogLevel: {
        description: "Log level for the publicClient module",
        type: "string",
        require: false
    },
    walletClientLogLevel: {
        description: "Log level for the walletClient module",
        type: "string",
        require: false
    },
    rpcLogLevel: {
        description: "Log level for the rpc module",
        type: "string",
        require: false
    },
    mempoolLogLevel: {
        description: "Log level for the mempool module",
        type: "string",
        require: false
    },
    executorLogLevel: {
        description: "Log level for the executor module",
        type: "string",
        require: false
    },
    reputationManagerLogLevel: {
        description: "Log level for the executor module",
        type: "string",
        require: false
    },
    nonceQueuerLogLevel: {
        description: "Log level for the executor module",
        type: "string",
        require: false
    },
    environment: {
        description: "Environment",
        type: "string",
        require: true,
        default: "production"
    },
    logEnvironment: {
        description: "Log environment",
        type: "string",
        require: true,
        default: "production"
    },
    tenderlyEnabled: {
        description: "Rpc url is a tenderly url",
        type: "boolean",
        require: true,
        default: false
    },
    minimumGasPricePercent: {
        description:
            "Minimum % of userop gasPrice compared to gasPrice used by the bundler",
        type: "number",
        require: true,
        default: 0
    },
    apiVersion: {
        description: "API version of the bundler",
        type: "string",
        require: false,
        default: "v1"
    },
    noEip1559Support: {
        description: "Rpc url does not support EIP1559",
        type: "boolean",
        require: true,
        default: false
    },
    noEthCallOverrideSupport: {
        description: "Rpc url does not support eth_call overrides",
        type: "boolean",
        require: true,
        default: false
    },
    balanceOverrideEnabled: {
        description:
            "True if RPC url supports eth_call balance state overrides",
        type: "boolean",
        require: true,
        default: false
    },
    useUserOperationGasLimitsForSubmission: {
        description: "Use user operation gas limits during submission",
        type: "boolean",
        require: true,
        default: false
    },
    flushStuckTransactionsDuringStartup: {
        description:
            "Should the bundler try to flush out all stuck pending transactions on startup",
        type: "boolean",
        require: true,
        default: false
    },
    customGasLimitForEstimation: {
        description: "Custom gas limit for estimation",
        type: "string"
    },
    disableExpirationCheck: {
        description: "Should the node make expiration checks",
        type: "boolean",
        require: false,
        default: false
    },
    bundleMode: {
        description:
            "Set if the bundler should run in auto bundle mode or not.",
        type: "string",
        require: false,
        default: "auto"
    },
    safeMode: {
        description: "Enable safe mode",
        type: "boolean",
        require: false,
        default: false
    },
    bundlerFrequency: {
        description: "How ofter in milliseconds to check and build new bundles",
        type: "number",
        require: false,
        default: 1000
    },
    rpcMaxBlockRange: {
        description: "Max block range for rpc calls",
        type: "number",
        require: false
    },
    dangerousSkipUserOperationValidation: {
        description: "Skip user operation validation, use with caution",
        type: "boolean",
        require: false,
        default: false
    },
    entryPointVersion: {
        description: "Version of the entry point",
        type: "string",
        require: false,
        default: "0.6"
    },
    gasPriceTimeValidityInSeconds: {
        description: "Time in seconds that the gas price is valid for",
        type: "number",
        require: false,
        default: 10
    }
}

export const bundlerCommand: CliCommand<IBundlerArgsInput> = {
    command: "run",
    describe: "Starts a bundler",
    options: bundlerOptions,
    handler: bundlerHandler,
    examples: [
        {
            command:
                "run --entryPoint 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789,0x0576a174D229E3cFA37253523E645A78A0C91B57 --signerPrivateKeys 1060ac9646dffa5dc19c188e148c627c50a0e8250a2f195ec3c493ffae3ed019",
            description: "Starts a bundler"
        }
    ]
}
