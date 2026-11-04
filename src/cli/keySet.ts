import { readFile } from "node:fs/promises"
import { addressSchema, hexData32Pattern } from "@alto/types"
import { Decrypter, armor } from "age-encryption"
import { privateKeyToAccount } from "viem/accounts"
import { z } from "zod"
import type { IOptionsInput } from "./config"

const KEY_ARGS = [
    "utility-private-key",
    "v6-executor-private-keys",
    "v7-executor-private-keys",
    "v8-executor-private-keys",
    "v9-executor-private-keys"
] as const

const EXECUTOR_VERSIONS = ["v6", "v7", "v8", "v9"] as const

// The addresses file mirrors the key set with addresses in place of keys
function keySetShape<T extends z.ZodTypeAny>(entry: T) {
    return z
        .object({
            version: z.literal(1),
            utility: entry.optional(),
            executors: z
                .object({
                    v6: z.array(entry).optional(),
                    v7: z.array(entry).optional(),
                    v8: z.array(entry).optional(),
                    v9: z.array(entry).optional()
                })
                .strict()
        })
        .strict()
}

const keySetSchema = keySetShape(z.string().regex(hexData32Pattern))
const addressesSchema = keySetShape(addressSchema)

type KeySet = z.infer<typeof keySetSchema>
type Addresses = z.infer<typeof addressesSchema>

function formatIssues(error: z.ZodError): string {
    // Paths and zod messages only, never the received values
    return error.issues
        .map((issue) =>
            issue.path.length > 0 ? issue.path.join(".") : issue.message
        )
        .join(", ")
}

function parseIdentities(identity: string): string[] {
    return identity
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
}

async function decryptKeySet({
    keySetFile,
    identity
}: {
    keySetFile: string
    identity: string
}): Promise<KeySet> {
    const ciphertext = await readFile(keySetFile, "utf8")

    const identities = parseIdentities(identity)
    if (identities.length === 0) {
        throw new Error("key-set-identity contains no age identity")
    }

    const decrypter = new Decrypter()
    for (const line of identities) {
        decrypter.addIdentity(line)
    }

    let file: Uint8Array
    try {
        file = armor.decode(ciphertext)
    } catch {
        throw new Error(
            "key-set-file is not an ASCII-armored age file (encrypt with age -a)"
        )
    }

    const plaintext = await decrypter.decrypt(file, "text")

    // JSON.parse errors quote the input, which here is private keys
    let json: unknown
    try {
        json = JSON.parse(plaintext)
    } catch {
        throw new Error("Decrypted key set is not valid JSON")
    }

    const parsed = keySetSchema.safeParse(json)
    if (!parsed.success) {
        throw new Error(
            `Invalid key set format at: ${formatIssues(parsed.error)}`
        )
    }

    const keys = [
        ...(parsed.data.utility ? [parsed.data.utility] : []),
        ...Object.values(parsed.data.executors).flat()
    ].map((key) => key.toLowerCase())
    if (new Set(keys).size !== keys.length) {
        throw new Error("Key set contains the same key more than once")
    }

    return parsed.data
}

async function readAddresses(addressesFile: string): Promise<Addresses> {
    const json: unknown = JSON.parse(await readFile(addressesFile, "utf8"))
    const parsed = addressesSchema.safeParse(json)
    if (!parsed.success) {
        throw new Error(
            `Invalid key-set-addresses-file at: ${formatIssues(parsed.error)}`
        )
    }
    return parsed.data
}

// Same addresses in the same order for every set, so a swapped key set
// fails unless the reviewable addresses file changes too
function verifyAddresses({
    keySet,
    addresses
}: {
    keySet: KeySet
    addresses: Addresses
}): void {
    const derive = (keys: string[]) =>
        keys.map((key) =>
            privateKeyToAccount(key as `0x${string}`).address.toLowerCase()
        )
    const normalize = (values: string[]) =>
        values.map((value) => value.toLowerCase())
    const optional = <T>(value: T | undefined) =>
        value === undefined ? [] : [value]

    const groups = [
        {
            name: "utility",
            derived: derive(optional(keySet.utility)),
            expected: normalize(optional(addresses.utility))
        },
        ...EXECUTOR_VERSIONS.map((version) => ({
            name: `executors.${version}`,
            derived: derive(keySet.executors[version] ?? []),
            expected: normalize(addresses.executors[version] ?? [])
        }))
    ]

    const mismatched = groups
        .filter(
            ({ derived, expected }) =>
                derived.length !== expected.length ||
                derived.some((address, i) => address !== expected[i])
        )
        .map(({ name }) => name)

    if (mismatched.length > 0) {
        throw new Error(
            `key-set-file does not match key-set-addresses-file at: ${mismatched.join(", ")}`
        )
    }
}

// The key set replaces every raw key arg, so a deployment can carry both
// while migrating
export async function applyKeySet(args: IOptionsInput): Promise<{
    args: IOptionsInput
    overriddenArgs: string[]
}> {
    const keySetFile = args["key-set-file"]
    if (!keySetFile) {
        return { args, overriddenArgs: [] }
    }

    const identity = args["key-set-identity"]
    if (!identity) {
        throw new Error("key-set-file requires key-set-identity")
    }

    const keySet = await decryptKeySet({ keySetFile, identity })

    const addressesFile = args["key-set-addresses-file"]
    if (addressesFile) {
        verifyAddresses({
            keySet,
            addresses: await readAddresses(addressesFile)
        })
    }

    const { "key-set-identity": _, ...rest } = args

    return {
        args: {
            ...rest,
            "utility-private-key": keySet.utility,
            "v6-executor-private-keys": keySet.executors.v6,
            "v7-executor-private-keys": keySet.executors.v7,
            "v8-executor-private-keys": keySet.executors.v8,
            "v9-executor-private-keys": keySet.executors.v9
        },
        overriddenArgs: KEY_ARGS.filter((arg) => args[arg] !== undefined)
    }
}
