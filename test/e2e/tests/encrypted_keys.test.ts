import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
    Encrypter,
    armor,
    generateIdentity,
    identityToRecipient
} from "age-encryption"
import type { EntryPointVersion } from "viem/account-abstraction"
import { privateKeyToAddress } from "viem/accounts"
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    inject,
    test
} from "vitest"
import {
    getAnvilPrivateKey,
    startAltoWithFlags
} from "../src/utils/altoInstance.js"
import {
    beforeEachCleanUp,
    getPublicClient,
    getSmartAccountClient
} from "../src/utils/index.js"

const ENCRYPTED_KEYS_ALTO_PORT = 8092

// Same anvil accounts startAltoWithFlags uses for its raw keys
const UTILITY_KEY = getAnvilPrivateKey(13)
const EXECUTOR_KEYS = {
    v6: [getAnvilPrivateKey(14)],
    v7: [getAnvilPrivateKey(15)],
    v8: [getAnvilPrivateKey(16)],
    v9: [getAnvilPrivateKey(17)]
}

const ENTRY_POINT_VERSIONS: {
    entryPointVersion: EntryPointVersion
    executorKey: keyof typeof EXECUTOR_KEYS
}[] = [
    { entryPointVersion: "0.6", executorKey: "v6" },
    { entryPointVersion: "0.7", executorKey: "v7" },
    { entryPointVersion: "0.8", executorKey: "v8" },
    { entryPointVersion: "0.9", executorKey: "v9" }
]

const encrypt = async ({
    recipient,
    plaintext
}: {
    recipient: string
    plaintext: string
}): Promise<string> => {
    const encrypter = new Encrypter()
    encrypter.addRecipient(recipient)
    return armor.encode(await encrypter.encrypt(plaintext))
}

describe("Encrypted key files", () => {
    const anvilRpc = inject("anvilRpc")

    let keysDir: string
    let encryptedKeysAlto: Awaited<ReturnType<typeof startAltoWithFlags>>

    beforeAll(async () => {
        const identity = await generateIdentity()
        const recipient = await identityToRecipient(identity)

        keysDir = await mkdtemp(join(tmpdir(), "alto-encrypted-keys-"))
        const executorKeysFile = join(keysDir, "executors.age")
        const executorAddressesFile = join(keysDir, "executors.json")
        const utilityKeyFile = join(keysDir, "utility.age")

        await Promise.all([
            writeFile(
                executorKeysFile,
                await encrypt({
                    recipient,
                    plaintext: JSON.stringify(EXECUTOR_KEYS)
                })
            ),
            writeFile(
                executorAddressesFile,
                JSON.stringify(
                    Object.fromEntries(
                        Object.entries(EXECUTOR_KEYS).map(([version, keys]) => [
                            version,
                            keys.map((key) => privateKeyToAddress(key))
                        ])
                    )
                )
            ),
            writeFile(
                utilityKeyFile,
                await encrypt({ recipient, plaintext: UTILITY_KEY })
            )
        ])

        encryptedKeysAlto = await startAltoWithFlags({
            anvilRpc,
            port: ENCRYPTED_KEYS_ALTO_PORT,
            flags: {
                // Unset the raw keys so the encrypted files are the only source
                "utility-private-key": undefined,
                "v6-executor-private-keys": undefined,
                "v7-executor-private-keys": undefined,
                "v8-executor-private-keys": undefined,
                "v9-executor-private-keys": undefined,
                "executor-keys-file": executorKeysFile,
                "executor-addresses-file": executorAddressesFile,
                "utility-key-file": utilityKeyFile,
                "age-identity": identity
            }
        })
    })

    afterAll(async () => {
        await encryptedKeysAlto?.stop()
        await rm(keysDir, { recursive: true, force: true })
    })

    beforeEach(async () => {
        await beforeEachCleanUp({
            anvilRpc,
            altoRpc: encryptedKeysAlto.altoRpc
        })
    })

    test.each(ENTRY_POINT_VERSIONS)(
        "$entryPointVersion userOp is bundled by the encrypted executor",
        async ({ entryPointVersion, executorKey }) => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc: encryptedKeysAlto.altoRpc
            })

            const hash = await smartAccountClient.sendUserOperation({
                calls: [
                    {
                        to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                        data: "0x",
                        value: 0n
                    }
                ]
            })
            const userOpReceipt =
                await smartAccountClient.waitForUserOperationReceipt({ hash })
            expect(userOpReceipt.success).toBe(true)

            const bundleTx = await getPublicClient(anvilRpc).getTransaction({
                hash: userOpReceipt.receipt.transactionHash
            })
            expect(bundleTx.from.toLowerCase()).toBe(
                privateKeyToAddress(EXECUTOR_KEYS[executorKey][0]).toLowerCase()
            )
        }
    )
})
