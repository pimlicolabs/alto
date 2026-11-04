import { readFile } from "node:fs/promises"
import { hexData32Pattern } from "@alto/types"
import { Decrypter, armor } from "age-encryption"
import { z } from "zod"
import type { IOptionsInput } from "./config"

const KEY_ARGS = [
    "utility-private-key",
    "v6-executor-private-keys",
    "v7-executor-private-keys",
    "v8-executor-private-keys",
    "v9-executor-private-keys"
] as const

const privateKeySchema = z.string().regex(hexData32Pattern)

const keySetSchema = z
    .object({
        version: z.literal(1),
        utility: privateKeySchema.optional(),
        executors: z
            .object({
                v6: z.array(privateKeySchema).optional(),
                v7: z.array(privateKeySchema).optional(),
                v8: z.array(privateKeySchema).optional(),
                v9: z.array(privateKeySchema).optional()
            })
            .strict()
    })
    .strict()

type KeySet = z.infer<typeof keySetSchema>

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
        // Paths and zod messages only, never the received values
        const paths = parsed.error.issues.map((issue) =>
            issue.path.length > 0 ? issue.path.join(".") : issue.message
        )
        throw new Error(`Invalid key set format at: ${paths.join(", ")}`)
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
