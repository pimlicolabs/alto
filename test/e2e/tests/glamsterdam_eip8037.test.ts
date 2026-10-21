import { http, type Hex, createTestClient, pad, toHex, zeroAddress } from "viem"
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
// EIP-8037 state gas for a new storage slot (64 bytes * CPSB)
const NEW_SLOT_STATE_GAS = 97_920n

// Loops 131,072 times (~3.4M gas), more than LOW_SIMULATION_GAS_LIMIT
//   PUSH3 0x020000; loop: JUMPDEST PUSH1 1 SWAP1 SUB DUP1 PUSH1 4 JUMPI; STOP
const GAS_BURNER = "0x00000000000000000000000000000000000b0b0b"
const GAS_BURNER_CODE: Hex = "0x620200005b600190038060045700"

// Writes 200 new slots at calldata[0:32] + 1..200 (~19.6M state gas), so
// its regular and state gas don't fit under TX_MAX_GAS_LIMIT
//   PUSH2 200; loop: JUMPDEST DUP1 DUP1 PUSH1 0 CALLDATALOAD ADD SSTORE
//   PUSH1 1 SWAP1 SUB DUP1 PUSH1 3 JUMPI; STOP
const STATE_CREATOR = "0x00000000000000000000000000000000000c0c0c"
const STATE_CREATOR_CODE: Hex = "0x6100c85b80806000350155600190038060035700"
const STATE_CREATOR_SLOTS = 200n

// Returns gasleft()
//   GAS PUSH1 0 MSTORE PUSH1 32 PUSH1 0 RETURN
const GAS_LEFT = "0x00000000000000000000000000000000000d0d0d"
const GAS_LEFT_CODE: Hex = "0x5a60005260206000f3"

let chain: Awaited<ReturnType<typeof startAmsterdamChain>>
let glamsterdamAlto: Awaited<ReturnType<typeof startAltoWithFlags>>
let lowCapAlto: Awaited<ReturnType<typeof startAltoWithFlags>>
// Whether the chain's calls get an EIP-8037 state gas reservoir: gasleft()
// only sees gas up to TX_MAX_GAS_LIMIT
let hasReservoir: boolean

beforeAll(async () => {
    chain = await startAmsterdamChain({ port: AMSTERDAM_ANVIL_PORT })
    const { data } = await getPublicClient(chain.anvilRpc).call({
        to: GAS_LEFT,
        gas: 2n * TX_MAX_GAS_LIMIT,
        stateOverride: [{ address: GAS_LEFT, code: GAS_LEFT_CODE }]
    })
    hasReservoir = BigInt(data ?? "0x0") <= TX_MAX_GAS_LIMIT
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
            const testClient = createTestClient({
                transport: http(chain.anvilRpc),
                chain: foundry,
                mode: "anvil"
            })
            await testClient.setCode({
                address: GAS_BURNER,
                bytecode: GAS_BURNER_CODE
            })
            await testClient.setCode({
                address: STATE_CREATOR,
                bytecode: STATE_CREATOR_CODE
            })
        })

        // A fresh salt per call, so every slot is new state
        const stateCreatorCalls = () =>
            [
                {
                    to: STATE_CREATOR,
                    data: pad(toHex(BigInt(Date.now())), { size: 32 }),
                    value: 0n
                }
            ] as const

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

        test("Estimation over TX_MAX_GAS_LIMIT moves state gas into preVerificationGas", async ({
            skip
        }) => {
            if (!hasReservoir) skip()

            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc: chain.anvilRpc,
                altoRpc: glamsterdamAlto.altoRpc
            })

            const { callGasLimit, verificationGasLimit, preVerificationGas } =
                await smartAccountClient.estimateUserOperationGas({
                    calls: stateCreatorCalls()
                })

            // The limits only cover execution gas
            expect(callGasLimit + verificationGasLimit).toBeLessThan(
                TX_MAX_GAS_LIMIT
            )
            expect(callGasLimit).toBeLessThan(
                STATE_CREATOR_SLOTS * NEW_SLOT_STATE_GAS
            )

            // preVerificationGas pays for the slots' state gas
            expect(preVerificationGas).toBeGreaterThanOrEqual(
                STATE_CREATOR_SLOTS * NEW_SLOT_STATE_GAS
            )
        })

        // Without a reservoir in eth_call, state gas can't be estimated
        // above TX_MAX_GAS_LIMIT
        test("Estimation falls back to metered without a reservoir in eth_call", async ({
            skip
        }) => {
            if (hasReservoir) skip()

            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc: chain.anvilRpc,
                altoRpc: glamsterdamAlto.altoRpc
            })

            const estimate = smartAccountClient.estimateUserOperationGas({
                calls: stateCreatorCalls()
            })
            await expect(estimate).rejects.toThrow()
            await expect(estimate).rejects.not.toThrow("EIP-8037 state gas")
        })

        test("Estimation leaves userOps under TX_MAX_GAS_LIMIT metered", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc: chain.anvilRpc,
                altoRpc: glamsterdamAlto.altoRpc
            })

            const { preVerificationGas } =
                await smartAccountClient.estimateUserOperationGas({
                    calls: [{ to: GAS_BURNER, data: "0x", value: 0n }]
                })

            // No reservoir: only the usual overhead (and the deployment's
            // refund slot state gas) is in preVerificationGas
            expect(preVerificationGas).toBeLessThan(1_000_000n)
        })
    }
)
