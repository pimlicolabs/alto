import { addressSchema } from "@alto/types"
import { z } from "zod"

export const bundlerArgsSchema = z.object({
    // allow both a comma separated list of addresses (better for cli and env vars) or an array of addresses (better for config files)
    entryPoint: addressSchema
    ,
    beneficiary: addressSchema,
    signerPrivateKey: z.string().regex(/^(0x)?([0-9a-f][0-9a-f]){0,32}$/, {
        message: "invalid private key, should be 32 byte hex with or without 0x prefix"
    }), // 32 bytes with or without 0x prefix
    rpcUrl: z.string().url(),

    minStake: z.number().int().min(0),
    minUnstakeDelay: z.number().int().min(0),

    maxBundleWaitTime: z.number().int().min(0),
    maxBundleSize: z.number().int().min(0),

    port: z.number().int().min(0)
})

export type IBundlerArgs = z.infer<typeof bundlerArgsSchema>
export type IBundlerArgsInput = z.input<typeof bundlerArgsSchema>
