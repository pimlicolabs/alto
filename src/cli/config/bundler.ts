import {
    type ApiVersion,
    addressSchema,
    commaSeperatedAddressPattern,
    hexData32Schema
} from "@alto/types"
import type { Hex } from "viem"
import { type Account, privateKeyToAccount } from "viem/accounts"
import { z } from "zod"

const logLevel = z.enum(["trace", "debug", "info", "warn", "error", "fatal"])

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
    "entrypoint-simulation-contract": z.preprocess(
        (v) => (v === "" ? undefined : v),
        addressSchema.optional()
    ),
    "safe-mode": z.boolean(),
    "utility-private-key": hexData32Schema
        .transform((val) => privateKeyToAccount(val) satisfies Account)
        .optional(),
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

    "min-entity-stake": z.number().int().min(0),
    "min-entity-unstake-delay": z.number().int().min(0),

    "max-bundle-wait": z.number().int().min(0),
    "max-bundle-size": z.number().int().min(0),

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

    "mempool-max-parallel-ops": z.number().int().min(0).default(10),
    "mempool-max-queued-ops": z.number().int().min(0).default(0),
    "enforce-unique-senders-per-bundle": z.boolean().default(true),
    "max-gas-per-bundle": z.string().transform((val) => BigInt(val)).default("5000000"),
})

export const compatibilityArgsSchema = z.object({
    "chain-type": z.enum(["default", "op-stack", "arbitrum"]),
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
    "max-block-range": z.number().int().min(0).optional()
})

export const bundleCopmressionArgsSchema = z.object({
    "bundle-bulker-address": addressSchema.optional(),
    "per-op-inflator-address": addressSchema.optional()
})

export const logArgsSchema = z.object({
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
    tenderly: z.boolean()
})

export type IBundlerArgs = z.infer<typeof bundlerArgsSchema>
export type IBundlerArgsInput = z.input<typeof bundlerArgsSchema>

export type ICompatibilityArgs = z.infer<typeof compatibilityArgsSchema>
export type ICompatibilityArgsInput = z.input<typeof compatibilityArgsSchema>

export type IServerArgs = z.infer<typeof serverArgsSchema>
export type IServerArgsInput = z.input<typeof serverArgsSchema>

export type IRpcArgs = z.infer<typeof rpcArgsSchema>
export type IRpcArgsInput = z.input<typeof rpcArgsSchema>

export type IBundleCompressionArgs = z.infer<typeof bundleCopmressionArgsSchema>
export type IBundleCompressionArgsInput = z.input<
    typeof bundleCopmressionArgsSchema
>

export type ILogArgs = z.infer<typeof logArgsSchema>
export type ILogArgsInput = z.input<typeof logArgsSchema>

export type IDebugArgs = z.infer<typeof debugArgsSchema>
export type IDebugArgsInput = z.input<typeof debugArgsSchema>

export const optionArgsSchema = z.object({
    ...bundlerArgsSchema.shape,
    ...compatibilityArgsSchema.shape,
    ...logArgsSchema.shape,
    ...serverArgsSchema.shape,
    ...rpcArgsSchema.shape,
    ...bundleCopmressionArgsSchema.shape,
    ...debugArgsSchema.shape
})

export type IOptions = z.infer<typeof optionArgsSchema>
export type IOptionsInput = z.input<typeof optionArgsSchema>
