import { addressSchema, hexData32Schema } from "@alto/types"
import { privateKeyToAccount } from "viem/accounts"
import { z } from "zod"

export const bundlerArgsSchema = z.object({
    // allow both a comma separated list of addresses (better for cli and env vars) or an array of addresses (better for config files)
    entryPoint: addressSchema,
    beneficiary: addressSchema,
    signerPrivateKeys: z.union([
        z.array(hexData32Schema).transform((vals) => vals.map((val) => privateKeyToAccount(val))),
        z
            .string()
            .regex(/^0x(?:[0-9a-f]{2}){32}(?:,0x(?:[0-9a-f]{2}){32})*$/)
            // @ts-ignore
            .transform((val) => val.split(",").map((val) => privateKeyToAccount(val)))
    ]),
    utilityPrivateKey: hexData32Schema.transform((val) => privateKeyToAccount(val)),
    maxSigners: z.number().int().min(0).optional(),
    rpcUrl: z.string().url(),
    
    minBalance: z.string().transform((val) => BigInt(val)),
    refillInterval: z.number().int().min(0),

    minStake: z.number().int().min(0),
    minUnstakeDelay: z.number().int().min(0),

    maxBundleWaitTime: z.number().int().min(0),
    maxBundleSize: z.number().int().min(0),

    port: z.number().int().min(0),
    pollingInterval: z.number().int().min(0),

    environment: z.enum(["production", "staging", "development"]),

    logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]),
    logEnvironment: z.enum(["production", "development"]),

    lokiHost: z.string().optional(),
    lokiUsername: z.string().optional(),
    lokiPassword: z.string().optional(),

    tenderlyEnabled: z.boolean().optional(),
})

export type IBundlerArgs = z.infer<typeof bundlerArgsSchema>
export type IBundlerArgsInput = z.input<typeof bundlerArgsSchema>
