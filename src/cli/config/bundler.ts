import { addressSchema, hexData32Schema } from "@entrypoint-0.6/types"
import type { Hex } from "viem"
import { type Account, privateKeyToAccount } from "viem/accounts"
import { z } from "zod"

const logLevel = z.enum(["trace", "debug", "info", "warn", "error", "fatal"])

export const bundlerArgsSchema = z.object({
    // allow both a comma separated list of addresses
    // (better for cli and env vars) or an array of addresses
    // (better for config files)
    entryPoint: addressSchema,
    entryPointSimulationsAddress: addressSchema.optional(),
    networkName: z.string(),
    signerPrivateKeys: z.union([
        z
            .array(hexData32Schema)
            .transform((vals) =>
                vals.map((val) => privateKeyToAccount(val) satisfies Account)
            ),
        z
            .string()
            .regex(/^0x(?:[0-9a-f]{2}){32}(?:,0x(?:[0-9a-f]{2}){32})*$/)
            // @ts-ignore
            .transform((val) =>
                val
                    .split(",")
                    .map(
                        (val) =>
                            privateKeyToAccount(val as Hex) satisfies Account
                    )
            )
    ]),
    signerPrivateKeysExtra: z
        .union([
            z
                .array(hexData32Schema)
                .transform((vals) =>
                    vals.map(
                        (val) => privateKeyToAccount(val) satisfies Account
                    )
                ),
            z
                .string()
                .regex(/^0x(?:[0-9a-f]{2}){32}(?:,0x(?:[0-9a-f]{2}){32})*$/)
                // @ts-ignore
                .transform((val) =>
                    val
                        .split(",")
                        .map(
                            (val) =>
                                privateKeyToAccount(
                                    val as Hex
                                ) satisfies Account
                        )
                )
        ])
        .optional(),
    utilityPrivateKey: hexData32Schema.transform(
        (val) => privateKeyToAccount(val) satisfies Account
    ),
    maxSigners: z.number().int().min(0).optional(),
    rpcUrl: z.string().url(),
    executionRpcUrl: z.string().url().optional(),

    bundleBulkerAddress: addressSchema.optional(),
    perOpInflatorAddress: addressSchema.optional(),

    minBalance: z.string().transform((val) => BigInt(val)),
    refillInterval: z.number().int().min(0),
    requestTimeout: z.number().int().min(0).optional(),

    minStake: z.number().int().min(0),
    minUnstakeDelay: z.number().int().min(0),

    maxBundleWaitTime: z.number().int().min(0),
    maxBundleSize: z.number().int().min(0),

    port: z.number().int().min(0),
    pollingInterval: z.number().int().min(0),

    environment: z.enum(["production", "staging", "development"]),

    logLevel: logLevel,
    publicClientLogLevel: logLevel.optional(),
    walletClientLogLevel: logLevel.optional(),
    rpcLogLevel: logLevel.optional(),
    mempoolLogLevel: logLevel.optional(),
    executorLogLevel: logLevel.optional(),
    reputationManagerLogLevel: logLevel.optional(),
    nonceQueuerLogLevel: logLevel.optional(),
    logEnvironment: z.enum(["production", "development"]),

    bundleMode: z.enum(["auto", "manual"]),
    bundlerFrequency: z.number().int().min(0),

    flushStuckTransactionsDuringStartup: z.boolean(),
    safeMode: z.boolean(),
    disableExpirationCheck: z.boolean(),

    tenderlyEnabled: z.boolean().optional(),
    minimumGasPricePercent: z.number().int().min(0),
    apiVersion: z.enum(["v1", "v2"]),
    noEip1559Support: z.boolean(),
    noEthCallOverrideSupport: z.boolean(),
    balanceOverrideEnabled: z.boolean(),
    useUserOperationGasLimitsForSubmission: z.boolean(),
    customGasLimitForEstimation: z
        .string()
        .transform((val) => BigInt(val))
        .optional(),
    rpcMaxBlockRange: z.number().int().min(0).optional(),
    dangerousSkipUserOperationValidation: z.boolean().optional(),
    entryPointVersion: z.enum(["0.6", "0.7"]),
    gasPriceTimeValidityInSeconds: z.number().int().min(0)
})

export type IBundlerArgs = z.infer<typeof bundlerArgsSchema>
export type IBundlerArgsInput = z.input<typeof bundlerArgsSchema>
