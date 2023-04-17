import { z } from "zod"
import { bundlerHandler } from "../app"
import { CliCommand, CliCommandOptions } from "./util"
import { addressSchema, hexData32Schema } from "../api/schemas"
import { getAddress } from "ethers/lib/utils"

// regex for addresses split up by comma
const addressListRegex = /^0x[a-fA-F0-9]{40}(,0x[a-fA-F0-9]{40})*$/

export const bundlerArgsSchema = z.object({
    // allow both a comma separated list of addresses (better for cli and env vars) or an array of addresses (better for config files)
    entryPoints: z.union([
        z
            .string()
            .regex(addressListRegex)
            .transform((s) => s.split(",").map((s) => getAddress(s.trim()))),
        z.array(addressSchema.transform((s) => getAddress(s))),
    ]),
    beneficiary: addressSchema,
    signerPrivateKey: z.string().regex(/^(0x)?([0-9a-f][0-9a-f]){0,32}$/, {
        message: "invalid private key, should be 32 byte hex with or without 0x prefix",
    }), // 32 bytes with or without 0x prefix
    rpcUrl: z.string().url(),

    minStake: z.number().int().min(0),
    minUnstakeDelay: z.number().int().min(0),

    maxBundleWaitTime: z.number().int().min(0),
    maxBundleSize: z.number().int().min(0),

    port: z.number().int().min(0),
})

export type IBundlerArgs = z.infer<typeof bundlerArgsSchema>
export type IBundlerArgsInput = z.input<typeof bundlerArgsSchema>

export const bundlerOptions: CliCommandOptions<IBundlerArgsInput> = {
    entryPoints: {
        description: "EntryPoint contract addresses split by commas",
        type: "string",
        require: true,
    },
    beneficiary: {
        description: "Beneficiary address to receive fees",
        type: "string",
        require: true,
    },
    signerPrivateKey: {
        description: "Private key of the signer",
        type: "string",
        require: true,
    },
    rpcUrl: {
        description: "RPC url to connect to",
        type: "string",
        require: true,
        default: "http://localhost:8545",
    },
    minStake: {
        description: "Minimum stake required for a relay (in 10e18)",
        type: "number",
        require: true,
        default: 1,
    },
    minUnstakeDelay: {
        description: "Minimum unstake delay",
        type: "number",
        require: true,
        default: 1,
    },
    maxBundleWaitTime: {
        description: "Maximum time to wait for a bundle to be submitted",
        type: "number",
        require: true,
        default: 3,
    },
    maxBundleSize: {
        description: "Maximum number of operations in mempool before a bundle is submitted",
        type: "number",
        require: true,
        default: 3,
    },
    port: {
        description: "Port to listen on",
        type: "number",
        require: true,
        default: 3000,
    },
}

export const bundlerCommand: CliCommand<IBundlerArgsInput> = {
    command: "run",
    describe: "Starts a bundler",
    options: bundlerOptions,
    handler: bundlerHandler,
    examples: [
        {
            command:
                "run --entryPoint 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789,0x0576a174D229E3cFA37253523E645A78A0C91B57 --beneficiary 0xa78fCd480107fBFAF84bDE5285A668396891d3E5 --signerPrivateKey 1060ac9646dffa5dc19c188e148c627c50a0e8250a2f195ec3c493ffae3ed019",
            description: "Starts a bundler",
        },
    ],
}
