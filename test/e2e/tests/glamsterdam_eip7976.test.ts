import { type Hex, size } from "viem"
import {
    type EntryPointVersion,
    entryPoint06Address,
    entryPoint07Address,
    entryPoint08Address,
    entryPoint09Address
} from "viem/account-abstraction"
import { generatePrivateKey } from "viem/accounts"
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    inject,
    test
} from "vitest"
import { startAltoWithFlags } from "../src/utils/altoInstance.js"
import {
    beforeEachCleanUp,
    getPublicClient,
    getSmartAccountClient
} from "../src/utils/index.js"

// EIP-7976: 16 gas per token, every calldata byte counts as 4 tokens
const EIP7976_FLOOR_PER_BYTE_GAS = 64n
const TRANSACTION_GAS_STIPEND = 21_000n
const FLAGGED_ALTO_PORT = 8090

const TO_ADDRESS = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
// Calldata-heavy call so the EIP-7976 floor dominates the standard cost
const CALLDATA: Hex = `0x${"00".repeat(1000)}${"ff".repeat(1000)}`
// Large enough that the bundle's gasLimit is set by the EIP-7976 floor
const LARGE_CALLDATA: Hex = `0x${"00".repeat(20_000)}`

const anvilRpc = inject("anvilRpc")
const altoRpc = inject("altoRpc")

let flaggedAlto: Awaited<ReturnType<typeof startAltoWithFlags>>

beforeAll(async () => {
    flaggedAlto = await startAltoWithFlags({
        anvilRpc,
        port: FLAGGED_ALTO_PORT,
        flags: { "supports-eip7976": true }
    })
})

afterAll(async () => {
    await flaggedAlto?.stop()
})

describe.each([
    {
        entryPoint: entryPoint06Address,
        entryPointVersion: "0.6" as EntryPointVersion
    },
    {
        entryPoint: entryPoint07Address,
        entryPointVersion: "0.7" as EntryPointVersion
    },
    {
        entryPoint: entryPoint08Address,
        entryPointVersion: "0.8" as EntryPointVersion
    },
    {
        entryPoint: entryPoint09Address,
        entryPointVersion: "0.9" as EntryPointVersion
    }
])("$entryPointVersion with supports-eip7976", ({ entryPointVersion }) => {
    const publicClient = getPublicClient(anvilRpc)
    const calls = [{ to: TO_ADDRESS, data: CALLDATA, value: 0n }] as const

    beforeEach(async () => {
        await beforeEachCleanUp({ anvilRpc, altoRpc })
    })

    test("PVG includes the EIP-7976 calldata floor", async () => {
        const privateKey = generatePrivateKey()
        const [defaultClient, flaggedClient] = await Promise.all([
            getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                privateKey
            }),
            getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc: flaggedAlto.altoRpc,
                privateKey
            })
        ])

        const [defaultEstimate, flaggedEstimate] = await Promise.all([
            defaultClient.estimateUserOperationGas({ calls: [...calls] }),
            flaggedClient.estimateUserOperationGas({ calls: [...calls] })
        ])

        expect(flaggedEstimate.preVerificationGas).toBeGreaterThan(
            defaultEstimate.preVerificationGas
        )
        // The userOp's callData wraps CALLDATA, so its floor is at least this
        expect(flaggedEstimate.preVerificationGas).toBeGreaterThanOrEqual(
            TRANSACTION_GAS_STIPEND +
                EIP7976_FLOOR_PER_BYTE_GAS * BigInt(size(CALLDATA))
        )
    })

    test("Mined bundle is above the EIP-7976 floor and PVG covers its gas", async () => {
        const smartAccountClient = await getSmartAccountClient({
            entryPointVersion,
            anvilRpc,
            altoRpc: flaggedAlto.altoRpc
        })

        const hash = await smartAccountClient.sendUserOperation({
            calls: [{ to: TO_ADDRESS, data: LARGE_CALLDATA, value: 0n }]
        })
        const userOpReceipt =
            await smartAccountClient.waitForUserOperationReceipt({ hash })
        expect(userOpReceipt.success).toBe(true)

        const bundleTx = await publicClient.getTransaction({
            hash: userOpReceipt.receipt.transactionHash
        })

        // A tx whose gasLimit is below its calldata floor is invalid
        expect(bundleTx.gas).toBeGreaterThanOrEqual(
            TRANSACTION_GAS_STIPEND +
                EIP7976_FLOOR_PER_BYTE_GAS * BigInt(size(bundleTx.input))
        )

        // The userOp paid for at least the gas the bundle used on-chain
        expect(userOpReceipt.actualGasUsed).toBeGreaterThanOrEqual(
            userOpReceipt.receipt.gasUsed
        )
    })
})
