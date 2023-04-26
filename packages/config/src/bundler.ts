import { addressSchema, hexData32Schema } from "@alto/types"
import { z } from "zod"

export const bundlerArgsSchema = z.object({
    // allow both a comma separated list of addresses (better for cli and env vars) or an array of addresses (better for config files)
    entryPoint: addressSchema,
    beneficiary: addressSchema,
    signerPrivateKey: hexData32Schema,
    rpcUrl: z.string().url(),
    minBalance: z.string().transform((val) => BigInt(val)),

    minStake: z.number().int().min(0),
    minUnstakeDelay: z.number().int().min(0),

    maxBundleWaitTime: z.number().int().min(0),
    maxBundleSize: z.number().int().min(0),

    port: z.number().int().min(0),
    pollingInterval: z.number().int().min(0),

    logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]),
    logEnvironment: z.enum(["production", "development"])
})

export type IBundlerArgs = z.infer<typeof bundlerArgsSchema>
export type IBundlerArgsInput = z.input<typeof bundlerArgsSchema>
