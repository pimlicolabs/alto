import { http, type Hex, createTestClient, zeroAddress } from "viem"
import {
    type EntryPointVersion,
    entryPoint06Address,
    entryPoint07Address,
    entryPoint08Address,
    entryPoint09Address
} from "viem/account-abstraction"
import { foundry } from "viem/chains"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"
import { startAltoWithFlags } from "../src/utils/altoInstance.js"
import { startAmsterdamChain } from "../src/utils/amsterdamChain.js"
import {
    beforeEachCleanUp,
    getPublicClient,
    getSmartAccountClient
} from "../src/utils/index.js"

// EIP-8037: tx gas above this goes into the state gas reservoir
const TX_MAX_GAS_LIMIT = 16_777_216n
// Low simulation gas for the instance that checks simulations respect it
const LOW_SIMULATION_GAS_LIMIT = 2_000_000n
const AMSTERDAM_ANVIL_PORT = 8548
const GLAMSTERDAM_ALTO_PORT = 8092
const LOW_CAP_ALTO_PORT = 8093

// Loops 131,072 times (~3.4M gas), more than LOW_SIMULATION_GAS_LIMIT
//   PUSH3 0x020000; loop: JUMPDEST PUSH1 1 SWAP1 SUB DUP1 PUSH1 4 JUMPI; STOP
const GAS_BURNER = "0x00000000000000000000000000000000000b0b0b"
const GAS_BURNER_CODE: Hex = "0x620200005b600190038060045700"

let chain: Awaited<ReturnType<typeof startAmsterdamChain>>
let glamsterdamAlto: Awaited<ReturnType<typeof startAltoWithFlags>>
let lowCapAlto: Awaited<ReturnType<typeof startAltoWithFlags>>

beforeAll(async () => {
    chain = await startAmsterdamChain({ port: AMSTERDAM_ANVIL_PORT })
    glamsterdamAlto = await startAltoWithFlags({
        anvilRpc: chain.anvilRpc,
        port: GLAMSTERDAM_ALTO_PORT,
        flags: {
            "glamsterdam-enabled": true,
            "transaction-gas-stipend": "15000"
        }
    })
    lowCapAlto = await startAltoWithFlags({
        anvilRpc: chain.anvilRpc,
        port: LOW_CAP_ALTO_PORT,
        flags: {
            "glamsterdam-enabled": true,
            "transaction-gas-stipend": "15000",
            "fixed-gas-limit-for-estimation":
                LOW_SIMULATION_GAS_LIMIT.toString()
        }
    })
})

afterAll(async () => {
    await lowCapAlto?.stop()
    await glamsterdamAlto?.stop()
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
    "$entryPointVersion on Amsterdam with glamsterdam-enabled",
    ({ entryPointVersion }) => {
        beforeEach(async () => {
            await beforeEachCleanUp({
                anvilRpc: chain.anvilRpc,
                altoRpc: glamsterdamAlto.altoRpc
            })
            await beforeEachCleanUp({
                anvilRpc: chain.anvilRpc,
                altoRpc: lowCapAlto.altoRpc
            })
            await createTestClient({
                transport: http(chain.anvilRpc),
                chain: foundry,
                mode: "anvil"
            }).setCode({ address: GAS_BURNER, bytecode: GAS_BURNER_CODE })
        })

        // Deploying the account and the first write to a new nonce key's
        // slot are both state creation during validation
        test("UserOp that creates state during validation is mined", async () => {
            const publicClient = getPublicClient(chain.anvilRpc)
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc: chain.anvilRpc,
                altoRpc: glamsterdamAlto.altoRpc
            })

            const nonce = await smartAccountClient.account.getNonce({
                key: BigInt(Date.now())
            })
            const hash = await smartAccountClient.sendUserOperation({
                calls: [{ to: zeroAddress, data: "0x", value: 0n }],
                nonce
            })
            const userOpReceipt =
                await smartAccountClient.waitForUserOperationReceipt({ hash })
            expect(userOpReceipt.success).toBe(true)

            const bundleTx = await publicClient.getTransaction({
                hash: userOpReceipt.receipt.transactionHash
            })

            // Above the cap, state gas comes from the reservoir and the
            // EntryPoint undercharges the userOp
            expect(bundleTx.gas).toBeLessThanOrEqual(TX_MAX_GAS_LIMIT)

            // The userOp paid for at least the gas the bundle used on-chain
            expect(userOpReceipt.actualGasUsed).toBeGreaterThanOrEqual(
                userOpReceipt.receipt.gasUsed
            )
        })

        test("Estimation is limited to --fixed-gas-limit-for-estimation", async () => {
            const calls = [{ to: GAS_BURNER, data: "0x", value: 0n }] as const

            const glamsterdamClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc: chain.anvilRpc,
                altoRpc: glamsterdamAlto.altoRpc
            })
            const { callGasLimit } =
                await glamsterdamClient.estimateUserOperationGas({ calls })
            expect(callGasLimit).toBeGreaterThan(LOW_SIMULATION_GAS_LIMIT)

            const lowCapClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc: chain.anvilRpc,
                altoRpc: lowCapAlto.altoRpc
            })
            await expect(
                lowCapClient.estimateUserOperationGas({ calls })
            ).rejects.toThrow()
        })
    }
)
