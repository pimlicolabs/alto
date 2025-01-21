import {
    type ApiVersion,
    addressSchema,
    bundlerRequestSchema,
    commaSeperatedAddressPattern,
    hexData32Schema
} from "@alto/types"
import type { Hex } from "viem"
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
    "entrypoint-simulation-contract": z.preprocess(
        (v) => (v === "" ? undefined : v),
        addressSchema.optional()
    ),
    "refill-helper-contract": addressSchema.optional(),
    "no-profit-bundling": z.boolean(),
    "safe-mode": z.boolean(),
    "utility-private-key": hexData32Schema
        .transform((val) => privateKeyToAccount(val) satisfies Account)
        .optional(),
    "utility-wallet-monitor": z.boolean(),
    "utility-wallet-monitor-interval": z.number(),
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

    "min-entity-stake": z.number().int().min(0),
    "min-entity-unstake-delay": z.number().int().min(0),

    "max-bundle-wait": z.number().int().min(0),
    "max-bundle-size": z.number().int().min(0),

    "gas-price-bump": z
        .string()
        .transform((val) => BigInt(val))
        .default("100"),
    "gas-price-floor-percent": z.number().int().min(0),
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
    "refilling-wallets": z.boolean().default(true),
    "aa95-gas-multiplier": z.string().transform((val) => BigInt(val)),
    "enable-instant-bundling-endpoint": z.boolean(),
    "enable-experimental-7702-endpoints": z.boolean()
})

export const compatibilityArgsSchema = z.object({
    "chain-type": z.enum([
        "default",
        "op-stack",
        "arbitrum",
        "hedera",
        "mantle",
        "skale"
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
    "local-gas-limit-calculation": z.boolean(),
    "flush-stuck-transactions-during-startup": z.boolean(),
    "fixed-gas-limit-for-estimation": z
        .string()
        .transform((val) => BigInt(val))
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
    "redis-event-manager-queue-name": z.string().optional(),
    json: z.boolean(),
    "network-name": z.string(),
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
    "deploy-simulations-contract": z.boolean(),
    tenderly: z.boolean()
})

export const gasEstimationArgsSchema = z.object({
    "binary-search-tolerance-delta": z
        .string()
        .transform((val) => BigInt(val))
        .default("1000"),
    "binary-search-gas-allowance": z
        .string()
        .transform((val) => BigInt(val))
        .default("1000000"),
    "v6-call-gas-limit-multiplier": z.string().transform((val) => BigInt(val)),
    "v7-call-gas-limit-multiplier": z.string().transform((val) => BigInt(val)),
    "v7-verification-gas-limit-multiplier": z
        .string()
        .transform((val) => BigInt(val)),
    "v7-paymaster-verification-gas-limit-multiplier": z
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
    "paymaster-gas-limit-multiplier": z.string().transform((val) => BigInt(val))
})

export type IBundlerArgs = z.infer<typeof bundlerArgsSchema>
export type IBundlerArgsInput = z.input<typeof bundlerArgsSchema>

export type ICompatibilityArgs = z.infer<typeof compatibilityArgsSchema>
export type ICompatibilityArgsInput = z.input<typeof compatibilityArgsSchema>

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

export const optionArgsSchema = z.object({
    ...bundlerArgsSchema.shape,
    ...compatibilityArgsSchema.shape,
    ...logArgsSchema.shape,
    ...serverArgsSchema.shape,
    ...rpcArgsSchema.shape,
    ...debugArgsSchema.shape,
    ...gasEstimationArgsSchema.shape
})

export type IOptions = z.infer<typeof optionArgsSchema>
export type IOptionsInput = z.input<typeof optionArgsSchema>
