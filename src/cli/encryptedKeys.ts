import { readFile } from "node:fs/promises"
import { addressSchema, hexData32Pattern } from "@alto/types"
import { Decrypter, armor } from "age-encryption"
import { privateKeyToAccount } from "viem/accounts"
import { z } from "zod"
import type { IOptionsInput } from "./config"

const EXECUTOR_VERSIONS = ["v6", "v7", "v8", "v9"] as const

const privateKeySchema = z.string().regex(hexData32Pattern)

// The addresses file mirrors the executor keys file with addresses in place
// of keys
function executorsShape<T extends z.ZodTypeAny>(entry: T) {
    return z
        .object({
            version: z.literal(1),
            v6: z.array(entry).optional(),
            v7: z.array(entry).optional(),
            v8: z.array(entry).optional(),
            v9: z.array(entry).optional()
        })
        .strict()
}

const executorKeysSchema = executorsShape(privateKeySchema)
const executorAddressesSchema = executorsShape(addressSchema)

type ExecutorKeys = z.infer<typeof executorKeysSchema>
type ExecutorAddresses = z.infer<typeof executorAddressesSchema>

function formatIssues(error: z.ZodError): string {
    // Paths and zod messages only, never the received values
    return error.issues
        .map((issue) =>
            issue.path.length > 0 ? issue.path.join(".") : issue.message
        )
        .join(", ")
}

function createDecrypter(identity: string): Decrypter {
    const identities = identity
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
    if (identities.length === 0) {
        throw new Error("age-identity contains no age identity")
    }

    const decrypter = new Decrypter()
    for (const line of identities) {
        decrypter.addIdentity(line)
    }
    return decrypter
}

async function decryptFile({
    decrypter,
    file,
    option
}: {
    decrypter: Decrypter
    file: string
    option: string
}): Promise<string> {
    const ciphertext = await readFile(file, "utf8")

    let bytes: Uint8Array
    try {
        bytes = armor.decode(ciphertext)
    } catch {
        throw new Error(
            `${option} is not an ASCII-armored age file (encrypt with age -a)`
        )
    }

    return await decrypter.decrypt(bytes, "text")
}

function toAddress(key: string): string {
    return privateKeyToAccount(key as `0x${string}`).address.toLowerCase()
}

async function loadExecutorKeys({
    decrypter,
    file,
    addressesFile
}: {
    decrypter: Decrypter
    file: string
    addressesFile: string
}): Promise<ExecutorKeys> {
    const plaintext = await decryptFile({
        decrypter,
        file,
        option: "executor-keys-file"
    })

    // JSON.parse errors quote the input, which here is private keys
    let json: unknown
    try {
        json = JSON.parse(plaintext)
    } catch {
        throw new Error("Decrypted executor-keys-file is not valid JSON")
    }

    const parsed = executorKeysSchema.safeParse(json)
    if (!parsed.success) {
        throw new Error(
            `Invalid executor-keys-file at: ${formatIssues(parsed.error)}`
        )
    }

    const keys = EXECUTOR_VERSIONS.flatMap(
        (version) => parsed.data[version] ?? []
    ).map((key) => key.toLowerCase())
    if (new Set(keys).size !== keys.length) {
        throw new Error("executor-keys-file contains the same key twice")
    }

    verifyExecutorAddresses({
        keys: parsed.data,
        addresses: await readExecutorAddresses(addressesFile)
    })

    return parsed.data
}

async function readExecutorAddresses(
    addressesFile: string
): Promise<ExecutorAddresses> {
    const json: unknown = JSON.parse(await readFile(addressesFile, "utf8"))
    const parsed = executorAddressesSchema.safeParse(json)
    if (!parsed.success) {
        throw new Error(
            `Invalid executor-addresses-file at: ${formatIssues(parsed.error)}`
        )
    }
    return parsed.data
}

// Same addresses in the same order per version, so swapping the ciphertext
// fails unless the reviewable addresses file changes too
function verifyExecutorAddresses({
    keys,
    addresses
}: {
    keys: ExecutorKeys
    addresses: ExecutorAddresses
}): void {
    const mismatched = EXECUTOR_VERSIONS.filter((version) => {
        const derived = (keys[version] ?? []).map(toAddress)
        const expected = (addresses[version] ?? []).map((address) =>
            address.toLowerCase()
        )
        return (
            derived.length !== expected.length ||
            derived.some((address, i) => address !== expected[i])
        )
    })

    if (mismatched.length > 0) {
        throw new Error(
            `executor-keys-file does not match executor-addresses-file at: ${mismatched.join(", ")}`
        )
    }
}

async function loadUtilityKey({
    decrypter,
    file
}: {
    decrypter: Decrypter
    file: string
}): Promise<string> {
    const plaintext = await decryptFile({
        decrypter,
        file,
        option: "utility-key-file"
    })

    const key = plaintext.trim()
    if (!privateKeySchema.safeParse(key).success) {
        throw new Error(
            "Decrypted utility-key-file is not a 32-byte hex private key"
        )
    }

    return key
}

// Each encrypted file replaces the raw args it covers, so a deployment can
// carry both while migrating
export async function applyEncryptedKeys(args: IOptionsInput): Promise<{
    args: IOptionsInput
    overriddenArgs: string[]
}> {
    const executorKeysFile = args["executor-keys-file"]
    const utilityKeyFile = args["utility-key-file"]
    if (!executorKeysFile && !utilityKeyFile) {
        return { args, overriddenArgs: [] }
    }

    const identity = args["age-identity"]
    if (!identity) {
        throw new Error(
            "executor-keys-file and utility-key-file require age-identity"
        )
    }
    const addressesFile = args["executor-addresses-file"]
    if (executorKeysFile && !addressesFile) {
        throw new Error("executor-keys-file requires executor-addresses-file")
    }
    const decrypter = createDecrypter(identity)

    const [executorKeys, utilityKey] = await Promise.all([
        executorKeysFile && addressesFile
            ? loadExecutorKeys({
                  decrypter,
                  file: executorKeysFile,
                  addressesFile
              })
            : undefined,
        utilityKeyFile
            ? loadUtilityKey({ decrypter, file: utilityKeyFile })
            : undefined
    ])

    const { "age-identity": _, ...rest } = args
    const result: IOptionsInput = { ...rest }
    const overriddenArgs: string[] = []

    if (executorKeys) {
        for (const version of EXECUTOR_VERSIONS) {
            const arg = `${version}-executor-private-keys` as const
            if (args[arg] !== undefined) {
                overriddenArgs.push(arg)
            }
            result[arg] = executorKeys[version]
        }
    }

    if (utilityKey) {
        if (args["utility-private-key"] !== undefined) {
            overriddenArgs.push("utility-private-key")
        }
        result["utility-private-key"] = utilityKey
    }

    return { args: result, overriddenArgs }
}
