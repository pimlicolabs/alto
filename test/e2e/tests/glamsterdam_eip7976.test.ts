import { type Hex, size } from "viem"
import {
    type EntryPointVersion,
    entryPoint06Address,
    entryPoint07Address,
    entryPoint08Address,
    entryPoint09Address
} from "viem/account-abstraction"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"
import { startAltoWithFlags } from "../src/utils/altoInstance.js"
import { startAmsterdamChain } from "../src/utils/amsterdamChain.js"
import {
    beforeEachCleanUp,
    getPublicClient,
    getSmartAccountClient
} from "../src/utils/index.js"

// EIP-7976: 16 gas per token, every calldata byte counts as 4 tokens
const EIP7976_FLOOR_PER_BYTE_GAS = 64n
// EIP-2780: base cost + cold recipient for a zero-value call
const TRANSACTION_GAS_STIPEND = 15_000n
const AMSTERDAM_ANVIL_PORT = 8546
const FLAGGED_ALTO_PORT = 8090

const TO_ADDRESS = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
// Calldata-heavy calls so the EIP-7976 floor dominates the standard cost
const CALLDATA: Hex = `0x${"00".repeat(1000)}${"ff".repeat(1000)}`
const LARGE_CALLDATA: Hex = `0x${"00".repeat(20_000)}`

let chain: Awaited<ReturnType<typeof startAmsterdamChain>>
let flaggedAlto: Awaited<ReturnType<typeof startAltoWithFlags>>

beforeAll(async () => {
    chain = await startAmsterdamChain({ port: AMSTERDAM_ANVIL_PORT })
    flaggedAlto = await startAltoWithFlags({
        anvilRpc: chain.anvilRpc,
        port: FLAGGED_ALTO_PORT,
        flags: {
            "supports-eip7976": true,
            "supports-eip2780": true,
            "transaction-gas-stipend": TRANSACTION_GAS_STIPEND.toString()
        }
    })
})

afterAll(async () => {
    await flaggedAlto?.stop()
    await chain?.stop()
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
])(
    "$entryPointVersion on Amsterdam with supports-eip7976",
    ({ entryPointVersion }) => {
        beforeEach(async () => {
            await beforeEachCleanUp({
                anvilRpc: chain.anvilRpc,
                altoRpc: flaggedAlto.altoRpc
            })
        })

        test.each([
            { name: "2 KB mixed callData", callData: CALLDATA },
            { name: "20 KB zero callData", callData: LARGE_CALLDATA }
        ])(
            "Bundle with $name is mined and PVG covers its gas",
            async ({ callData }) => {
                const publicClient = getPublicClient(chain.anvilRpc)
                const smartAccountClient = await getSmartAccountClient({
                    entryPointVersion,
                    anvilRpc: chain.anvilRpc,
                    altoRpc: flaggedAlto.altoRpc
                })

                const hash = await smartAccountClient.sendUserOperation({
                    calls: [{ to: TO_ADDRESS, data: callData, value: 0n }]
                })
                const userOpReceipt =
                    await smartAccountClient.waitForUserOperationReceipt({
                        hash
                    })
                expect(userOpReceipt.success).toBe(true)

                const bundleTx = await publicClient.getTransaction({
                    hash: userOpReceipt.receipt.transactionHash
                })

                // The chain rejects a tx whose gasLimit is below its calldata floor
                expect(bundleTx.gas).toBeGreaterThanOrEqual(
                    TRANSACTION_GAS_STIPEND +
                        EIP7976_FLOOR_PER_BYTE_GAS *
                            BigInt(size(bundleTx.input))
                )

                // The userOp paid for at least the gas the bundle used on-chain
                expect(userOpReceipt.actualGasUsed).toBeGreaterThanOrEqual(
                    userOpReceipt.receipt.gasUsed
                )
            }
        )
    }
)
