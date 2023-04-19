import { addressSchema } from "@alto/types"
import { getAddress } from "viem"
import { z } from "zod"

// regex for addresses split up by comma
const addressListRegex = /^0x[a-fA-F0-9]{40}(,0x[a-fA-F0-9]{40})*$/

export const bundlerArgsSchema = z.object({
    // allow both a comma separated list of addresses (better for cli and env vars) or an array of addresses (better for config files)
    entryPoints: z.union([
        z
            .string()
            .regex(addressListRegex)
            .transform((s) => s.split(",").map((s) => getAddress(s.trim()))),
        z.array(addressSchema.transform((s) => getAddress(s)))
    ]),
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
