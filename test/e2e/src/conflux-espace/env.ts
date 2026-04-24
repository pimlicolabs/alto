import { generatePrivateKey } from "viem/accounts"

export type ConfluxEspaceDemoEnv = {
    rpcUrl: string
    sendTransactionRpcUrl?: string
    bundlerPrivateKey: `0x${string}`
    executorPrivateKeys: string
    ownerPrivateKey: `0x${string}`
    port: number
    blockTimeMs: number
    logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal"
    safeMode: boolean
    balanceOverride: boolean
    codeOverrideSupport: boolean
}

let cachedEnv: ConfluxEspaceDemoEnv | undefined

const requireString = (name: string) => {
    const value = process.env[name]?.trim()

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`)
    }

    return value
}

const parseUrl = ({
    name,
    fallback
}: {
    name: string
    fallback?: string
}) => {
    const value = process.env[name]?.trim() || fallback

    if (!value) {
        return undefined
    }

    try {
        return new URL(value).toString()
    } catch {
        throw new Error(`Invalid URL environment variable: ${name}`)
    }
}

const parsePrivateKey = ({
    name,
    fallback
}: {
    name: string
    fallback?: `0x${string}`
}) => {
    const value = process.env[name]?.trim() || fallback

    if (!value) {
        return undefined
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
        throw new Error(`Invalid private key environment variable: ${name}`)
    }

    return value as `0x${string}`
}

const parseNumber = ({
    name,
    fallback,
    min
}: {
    name: string
    fallback: number
    min: number
}) => {
    const raw = process.env[name]?.trim()
    const value = raw ? Number(raw) : fallback

    if (!Number.isInteger(value) || value < min) {
        throw new Error(`Invalid numeric environment variable: ${name}`)
    }

    return value
}

const parseBoolean = ({
    name,
    fallback
}: {
    name: string
    fallback: boolean
}) => {
    const raw = process.env[name]?.trim().toLowerCase()

    if (!raw) {
        return fallback
    }

    if (raw === "true") {
        return true
    }

    if (raw === "false") {
        return false
    }

    throw new Error(`Invalid boolean environment variable: ${name}`)
}

const parseLogLevel = (name: string): ConfluxEspaceDemoEnv["logLevel"] => {
    const raw = process.env[name]?.trim()

    if (!raw) {
        return "debug"
    }

    switch (raw) {
        case "trace":
        case "debug":
        case "info":
        case "warn":
        case "error":
        case "fatal":
            return raw
        default:
            throw new Error(`Invalid log level environment variable: ${name}`)
    }
}

export const getConfluxEspaceDemoEnv = (): ConfluxEspaceDemoEnv => {
    if (cachedEnv) {
        return cachedEnv
    }

    const bundlerPrivateKey = parsePrivateKey({
        name: "CONFLUX_ESPACE_TESTNET_BUNDLER_PRIVATE_KEY"
    })

    if (!bundlerPrivateKey) {
        throw new Error(
            "Missing required environment variable: CONFLUX_ESPACE_TESTNET_BUNDLER_PRIVATE_KEY"
        )
    }

    cachedEnv = {
        rpcUrl: parseUrl({
            name: "CONFLUX_ESPACE_TESTNET_RPC_URL",
            fallback: requireString("CONFLUX_ESPACE_TESTNET_RPC_URL")
        }) as string,
        sendTransactionRpcUrl: parseUrl({
            name: "CONFLUX_ESPACE_TESTNET_SEND_TRANSACTION_RPC_URL"
        }),
        bundlerPrivateKey,
        executorPrivateKeys:
            process.env.CONFLUX_ESPACE_TESTNET_EXECUTOR_PRIVATE_KEYS?.trim() ??
            bundlerPrivateKey,
        ownerPrivateKey:
            parsePrivateKey({
                name: "CONFLUX_ESPACE_TESTNET_OWNER_PRIVATE_KEY"
            }) ?? generatePrivateKey(),
        port: parseNumber({
            name: "CONFLUX_ESPACE_TESTNET_PORT",
            fallback: 4337,
            min: 1
        }),
        blockTimeMs: parseNumber({
            name: "CONFLUX_ESPACE_TESTNET_BLOCK_TIME_MS",
            fallback: 1_000,
            min: 100
        }),
        logLevel: parseLogLevel("CONFLUX_ESPACE_TESTNET_LOG_LEVEL"),
        safeMode: parseBoolean({
            name: "CONFLUX_ESPACE_TESTNET_SAFE_MODE",
            fallback: false
        }),
        balanceOverride: parseBoolean({
            name: "CONFLUX_ESPACE_TESTNET_BALANCE_OVERRIDE",
            fallback: false
        }),
        codeOverrideSupport: parseBoolean({
            name: "CONFLUX_ESPACE_TESTNET_CODE_OVERRIDE_SUPPORT",
            fallback: false
        })
    }

    return cachedEnv
}
