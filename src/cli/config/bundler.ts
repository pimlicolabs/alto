import {
    type ApiVersion,
    addressSchema,
    bundlerRequestSchema,
    commaSeperatedAddressPattern,
    hexData32Schema
} from "@alto/types"
import { parseGwei, type Hex } from "viem"
import { type Account, privateKeyToAccount } from "viem/accounts"
import { z } from "zod"

const logLevel = z.enum(["trace", "debug", "info", "warn", "error", "fatal"])

const rpcMethodNames = bundlerRequestSchema.options.map(
    (s) => s.shape.method._def.value
) as [string, ...string[]]

export const bundlerArgsSchema = z.object({
    entrypoints: z
        .string()
        .regex(commaSeperatedAddressPattern)
        .transform((val) => {
            const addresses = val.split(",")
            const validatedAddresses = addresses.map(
                (address) => addressSchema.parse(address.trim()) // Trimming to handle spaces after commas
            )
            return validatedAddresses
        }),
    "deterministic-deployer-address": addressSchema,
    "safe-mode": z.boolean(),

    "min-entity-stake": z.number().int().min(0),
    "min-entity-unstake-delay": z.number().int().min(0),

    "gas-price-bump": z
        .string()
        .transform((val) => BigInt(val))
        .default("100"),
    "gas-price-expiry": z.number().int().min(0),
    "gas-price-multipliers": z
        .string()
        .transform((value) => value.split(",").map(BigInt))
        .refine(
            (values) => values.length === 3,
            "Must contain 3 comma seperated items in format: slow,standard,fast"
        )
        .transform(([slow, standard, fast]) => ({ slow, standard, fast })),
    "gas-price-refresh-interval": z.number().int().min(0),

    "mempool-max-parallel-ops": z.number().int().min(0).default(10),
    "mempool-max-queued-ops": z.number().int().min(0).default(0),
    "enforce-unique-senders-per-bundle": z.boolean().default(true),
    "max-gas-per-bundle": z
        .string()
        .transform((val) => BigInt(val))
        .default("20000000"),
    "rpc-methods": z
        .string()
        .nullable()
        .transform((val: string | null) => {
            if (val === null) return null

            return val.split(",")
        })
        .refine((values) => {
            if (values === null) return true

            return values.length > 0
        }, "Must contain at least one method if specified")
        .refine(
            (values) => {
                if (values === null) return true

                return values.every((value: string) =>
                    rpcMethodNames.includes(value)
                )
            },
            `Unknown method specified, available methods: ${rpcMethodNames.join(
                ","
            )}`
        ),
    "enable-instant-bundling-endpoint": z.boolean(),
    "should-check-prefund": z.boolean()
})

export const executorArgsSchema = z.object({
    "enable-fastlane": z.boolean(),
    "resubmit-stuck-timeout": z.number().int().min(0).default(15_000),
    "refilling-wallets": z.boolean().default(true),
    "aa95-gas-multiplier": z.string().transform((val) => BigInt(val)),
    "refill-helper-contract": addressSchema.optional(),
    "no-profit-bundling": z.boolean(),
    "utility-private-key": hexData32Schema
        .transform((val) => privateKeyToAccount(val) satisfies Account)
        .optional(),
    "utility-wallet-monitor": z.boolean(),
    "utility-wallet-monitor-interval": z.number(),
    "resubmit-multiplier-ceiling": z.string().transform((val) => BigInt(val)),
    "gas-limit-rounding-multiple": z
        .string()
        .transform((val) => BigInt(val))
        .refine(
            (value) => value > 0n,
            "Gas limit rounding multiple must be a positive number"
        )
        .optional()
        .default("4337"),
    "executor-private-keys": z.union([
        z
            .array(hexData32Schema)
            .transform((vals) =>
                vals.map((val) => privateKeyToAccount(val) satisfies Account)
            ),
        z
            .string()
            .regex(/^0x(?:[0-9a-f]{2}){32}(?:,0x(?:[0-9a-f]{2}){32})*$/)
            .transform((val) =>
                val
                    .split(",")
                    .map(
                        (val) =>
                            privateKeyToAccount(val as Hex) satisfies Account
                    )
            )
    ]),
    "max-executors": z.number().int().min(0).optional(),
    "min-executor-balance": z
        .string()
        .transform((val) => BigInt(val))
        .optional(),
    "executor-refill-interval": z.number().int().min(0),
    "executor-gas-multiplier": z.string().transform((val) => BigInt(val)),
    "send-handle-ops-retry-count": z.number().int().default(3),
    "transaction-underpriced-multiplier": z
        .string()
        .transform((val) => BigInt(val))
})

export const compatibilityArgsSchema = z.object({
    "chain-type": z.enum([
        "default",
        "op-stack",
        "arbitrum",
        "hedera",
        "mantle"
    ]),
    "legacy-transactions": z.boolean(),
    "api-version": z
        .string()
        .regex(/^(v1,v2|v2,v1|v1|v2)$/)
        .optional()
        .default("v1,v2")
        .transform((val) => val.split(",") as ApiVersion[]),
    "default-api-version": z
        .enum(["v1", "v2"])
        .optional()
        .transform((val) => val as ApiVersion),
    "balance-override": z.boolean(),
    "flush-stuck-transactions-during-startup": z.boolean(),
    "is-gas-free-chain": z.boolean(),
    "fixed-gas-limit-for-estimation": z
        .string()
        .transform((val) => BigInt(val))
        .optional(),
    "floor-max-fee-per-gas": z
        .string()
        .transform((val) => parseGwei(val))
        .optional(),
    "floor-max-priority-fee-per-gas": z
        .string()
        .transform((val) => parseGwei(val))
        .optional()
})

export const serverArgsSchema = z.object({
    port: z.number().int().min(0),
    timeout: z.number().int().min(0).optional(),
    websocket: z.boolean().default(false),
    "websocket-max-payload-size": z
        .number()
        .int()
        .min(1024)
        .default(1024 * 1024) // 1 mb
})

export const rpcArgsSchema = z.object({
    "rpc-url": z.string().url(),
    "send-transaction-rpc-url": z.string().url().optional(),
    "polling-interval": z.number().int().min(0),
    "max-block-range": z.number().int().min(0).optional(),
    "block-tag-support": z.boolean().optional().default(true),
    "code-override-support": z.boolean().optional().default(false)
})

export const logArgsSchema = z.object({
    "redis-queue-endpoint": z.string().optional(),
    "redis-event-manager-queue-name": z.preprocess(
        (v) => (v === "" ? undefined : v),
        z.string().optional()
    ),
    json: z.boolean(),
    "log-level": logLevel,
    "public-client-log-level": logLevel.optional(),
    "wallet-client-log-level": logLevel.optional(),
    "rpc-log-level": logLevel.optional(),
    "mempool-log-level": logLevel.optional(),
    "executor-log-level": logLevel.optional(),
    "reputation-manager-log-level": logLevel.optional(),
    "nonce-queuer-log-level": logLevel.optional()
})

export const debugArgsSchema = z.object({
    "bundle-mode": z.enum(["auto", "manual"]),
    "enable-debug-endpoints": z.boolean(),
    "expiration-check": z.boolean(),
    "dangerous-skip-user-operation-validation": z.boolean(),
    "deploy-simulations-contract": z.boolean()
})

export const gasEstimationArgsSchema = z.object({
    "entrypoint-simulation-contract-v7": z.preprocess(
        (v) => (v === "" ? undefined : v),
        addressSchema.optional()
    ),
    "entrypoint-simulation-contract-v8": z.preprocess(
        (v) => (v === "" ? undefined : v),
        addressSchema.optional()
    ),
    "binary-search-tolerance-delta": z
        .string()
        .transform((val) => BigInt(val))
        .default("1000"),
    "binary-search-gas-allowance": z
        .string()
        .transform((val) => BigInt(val))
        .default("1000000"),
    "v6-call-gas-limit-multiplier": z.string().transform((val) => BigInt(val)),
    "v6-verification-gas-limit-multiplier": z
        .string()
        .transform((val) => BigInt(val)),
    "v7-call-gas-limit-multiplier": z.string().transform((val) => BigInt(val)),
    "v7-verification-gas-limit-multiplier": z
        .string()
        .transform((val) => BigInt(val)),
    "v7-paymaster-verification-gas-limit-multiplier": z
        .string()
        .transform((val) => BigInt(val)),
    "v7-paymaster-post-op-gas-limit-multiplier": z
        .string()
        .transform((val) => BigInt(val)),
    "simulation-call-gas-limit": z.string().transform((val) => BigInt(val)),
    "simulation-verification-gas-limit": z
        .string()
        .transform((val) => BigInt(val)),
    "simulation-paymaster-verification-gas-limit": z
        .string()
        .transform((val) => BigInt(val)),
    "simulation-paymaster-post-op-gas-limit": z
        .string()
        .transform((val) => BigInt(val)),
    "paymaster-gas-limit-multiplier": z
        .string()
        .transform((val) => BigInt(val)),
    "eth-call-sender-address": addressSchema.optional(),
    "split-simulation-calls": z.boolean()
})

export const mempoolArgsSchema = z.object({
    "redis-mempool-url": z.string().optional(),
    "redis-mempool-concurrency": z.number().int().min(0).default(10),
    "redis-mempool-queue-name": z.string(),
    "redis-sender-manager-url": z.string().optional(),
    "redis-sender-manager-queue-name": z.string(),
    "redis-gas-price-queue-url": z.string().optional(),
    "redis-gas-price-queue-name": z.string(),
    "mempool-max-parallel-ops": z.number().int().min(0).default(10),
    "mempool-max-queued-ops": z.number().int().min(0).default(0),
    "enforce-unique-senders-per-bundle": z.boolean().default(true)
})

export type IBundlerArgs = z.infer<typeof bundlerArgsSchema>
export type IBundlerArgsInput = z.input<typeof bundlerArgsSchema>

export type ICompatibilityArgs = z.infer<typeof compatibilityArgsSchema>
export type ICompatibilityArgsInput = z.input<typeof compatibilityArgsSchema>

export type IExecutorArgs = z.infer<typeof executorArgsSchema>
export type IExecutorArgsInput = z.input<typeof executorArgsSchema>

export type IServerArgs = z.infer<typeof serverArgsSchema>
export type IServerArgsInput = z.input<typeof serverArgsSchema>

export type IRpcArgs = z.infer<typeof rpcArgsSchema>
export type IRpcArgsInput = z.input<typeof rpcArgsSchema>

export type ILogArgs = z.infer<typeof logArgsSchema>
export type ILogArgsInput = z.input<typeof logArgsSchema>

export type IDebugArgs = z.infer<typeof debugArgsSchema>
export type IDebugArgsInput = z.input<typeof debugArgsSchema>

export type IGasEstimationArgs = z.infer<typeof gasEstimationArgsSchema>
export type IGasEstimationArgsInput = z.input<typeof gasEstimationArgsSchema>

export type IMempoolArgs = z.infer<typeof mempoolArgsSchema>
export type IMempoolArgsInput = z.input<typeof mempoolArgsSchema>

export const optionArgsSchema = z.object({
    ...bundlerArgsSchema.shape,
    ...compatibilityArgsSchema.shape,
    ...logArgsSchema.shape,
    ...serverArgsSchema.shape,
    ...rpcArgsSchema.shape,
    ...debugArgsSchema.shape,
    ...gasEstimationArgsSchema.shape,
    ...executorArgsSchema.shape,
    ...mempoolArgsSchema.shape
})

export type IOptions = z.infer<typeof optionArgsSchema>
export type IOptionsInput = z.input<typeof optionArgsSchema>
