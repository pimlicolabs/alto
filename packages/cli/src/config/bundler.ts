import { addressSchema, hexData32Schema } from "@alto/types"
import { Hex } from "viem"
import { Account, privateKeyToAccount } from "viem/accounts"
import { z } from "zod"

export const bundlerArgsSchema = z.object({
    // allow both a comma separated list of addresses
    // (better for cli and env vars) or an array of addresses
    // (better for config files)
    entryPoint: addressSchema,
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

    logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]),
    logEnvironment: z.enum(["production", "development"]),

    bundleMode: z.enum(["auto", "manual"]),
    bundlerFrequency: z.number().int().min(0),

    flushStuckTransactionsDuringStartup: z.boolean(),
    safeMode: z.boolean(),

    tenderlyEnabled: z.boolean().optional(),
    minimumGasPricePercent: z.number().int().min(0),
    noEip1559Support: z.boolean(),
    noEthCallOverrideSupport: z.boolean(),
    balanceOverrideEnabled: z.boolean(),
    useUserOperationGasLimitsForSubmission: z.boolean(),
    customGasLimitForEstimation: z
        .string()
        .transform((val) => BigInt(val))
        .optional(),
    rpcMaxBlockRange: z.number().int().min(0).optional(),
    kintoEntryPointVersion: z.boolean().optional()
})

export type IBundlerArgs = z.infer<typeof bundlerArgsSchema>
export type IBundlerArgsInput = z.input<typeof bundlerArgsSchema>
