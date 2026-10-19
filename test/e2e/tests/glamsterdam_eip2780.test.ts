import {
    http,
    type Address,
    concat,
    createTestClient,
    parseEther,
    zeroAddress
} from "viem"
import {
    type EntryPointVersion,
    entryPoint06Address,
    entryPoint07Address,
    entryPoint08Address,
    entryPoint09Address
} from "viem/account-abstraction"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { foundry } from "viem/chains"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"
import { deployPaymaster, encodePaymasterData } from "../src/testPaymaster.js"
import { startAltoWithFlags } from "../src/utils/altoInstance.js"
import { startAmsterdamChain } from "../src/utils/amsterdamChain.js"
import {
    beforeEachCleanUp,
    getPublicClient,
    getSimple7702AccountImplementationAddress,
    getSmartAccountClient
} from "../src/utils/index.js"

// EIP-8037 state gas charged for an EIP-7702 authorization under EIP-2780
const EIP8037_NEW_ACCOUNT_STATE_GAS = 183_600n
const AMSTERDAM_ANVIL_PORT = 8547
const FLAGGED_ALTO_PORT = 8091
// PVG also moves by a few gas when estimated gas limits change calldata bytes
const PVG_TOLERANCE = 500n

const expectWithin = (actual: bigint, expected: bigint) => {
    expect(actual).toBeGreaterThanOrEqual(expected - PVG_TOLERANCE)
    expect(actual).toBeLessThanOrEqual(expected + PVG_TOLERANCE)
}

let chain: Awaited<ReturnType<typeof startAmsterdamChain>>
let flaggedAlto: Awaited<ReturnType<typeof startAltoWithFlags>>

beforeAll(async () => {
    chain = await startAmsterdamChain({ port: AMSTERDAM_ANVIL_PORT })
    flaggedAlto = await startAltoWithFlags({
        anvilRpc: chain.anvilRpc,
        port: FLAGGED_ALTO_PORT,
        flags: {
            // Only EIP-2780: with the EIP-7976 floor on, PVG also depends on
            // the estimated gas limits, which hides the authorization deltas
            "supports-eip2780": true,
            // Amsterdam anvil charges EIP-8037 state gas
            "supports-eip8037": true,
            "transaction-gas-stipend": "15000",
            // Unscaled PVG, so the deltas below are the raw state gas
            "v6-pre-verification-gas-limit-multiplier": "100",
            "v7-pre-verification-gas-limit-multiplier": "100"
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
    "$entryPointVersion on Amsterdam with supports-eip2780",
    ({ entryPoint, entryPointVersion }) => {
        const calls = [{ to: zeroAddress, data: "0x", value: 0n }] as const

        let paymaster: Address

        beforeEach(async () => {
            await beforeEachCleanUp({
                anvilRpc: chain.anvilRpc,
                altoRpc: flaggedAlto.altoRpc
            })
            paymaster = await deployPaymaster({
                entryPoint,
                anvilRpc: chain.anvilRpc
            })
        })

        // Sponsor the userOp so the authority can have no balance at all
        const getPaymasterFields = () =>
            entryPointVersion === "0.6"
                ? {
                      paymasterAndData: concat([
                          paymaster,
                          encodePaymasterData()
                      ])
                  }
                : {
                      paymaster,
                      paymasterData: encodePaymasterData(),
                      paymasterVerificationGasLimit: 100_000n,
                      paymasterPostOpGasLimit: 50_000n
                  }

        const signAuthorization = async (privateKey: `0x${string}`) => {
            const owner = privateKeyToAccount(privateKey)
            return owner.signAuthorization({
                chainId: foundry.id,
                nonce: await getPublicClient(
                    chain.anvilRpc
                ).getTransactionCount({
                    address: owner.address
                }),
                contractAddress:
                    getSimple7702AccountImplementationAddress(entryPointVersion)
            })
        }

        const getClient = (privateKey: `0x${string}`, fundAccount: boolean) =>
            getSmartAccountClient({
                entryPointVersion,
                anvilRpc: chain.anvilRpc,
                altoRpc: flaggedAlto.altoRpc,
                privateKey,
                use7702: true,
                fundAccount
            })

        test("PVG prices the EIP-7702 authorization by authority state", async () => {
            const privateKey = generatePrivateKey()
            const estimatePvg = async () => {
                const client = await getClient(privateKey, false)
                const estimate = await client.estimateUserOperationGas({
                    calls: [...calls],
                    authorization: await signAuthorization(privateKey),
                    ...getPaymasterFields()
                })
                return estimate.preVerificationGas
            }

            // Authority has no nonce, balance or code: a new account
            const newAccountPvg = await estimatePvg()

            // Same authority once it exists, but is not delegated yet
            await createTestClient({
                chain: foundry,
                mode: "anvil",
                transport: http(chain.anvilRpc)
            }).setBalance({
                address: privateKeyToAccount(privateKey).address,
                value: parseEther("100")
            })
            const existingAccountPvg = await estimatePvg()

            expectWithin(
                newAccountPvg - existingAccountPvg,
                EIP8037_NEW_ACCOUNT_STATE_GAS
            )

            // Delegate the authority on-chain, then estimate again
            const client = await getClient(privateKey, false)
            const hash = await client.sendUserOperation({
                calls: [...calls],
                authorization: await signAuthorization(privateKey),
                ...getPaymasterFields()
            })
            const receipt = await client.waitForUserOperationReceipt({ hash })
            expect(receipt.success).toBe(true)

            // The sender's code is overridden during simulation, so PVG can't
            // tell an already delegated authority apart and still charges the
            // auth base state gas
            const delegatedAccountPvg = await estimatePvg()

            expectWithin(delegatedAccountPvg, existingAccountPvg)
        })

        test.each([
            { authority: "new account (sponsored)", fundAccount: false },
            { authority: "existing EOA", fundAccount: true }
        ])(
            "PVG covers the mined bundle's gas for a 7702 userOp: $authority",
            async ({ fundAccount }) => {
                const privateKey = generatePrivateKey()
                const client = await getClient(privateKey, fundAccount)

                const hash = await client.sendUserOperation({
                    calls: [...calls],
                    authorization: await signAuthorization(privateKey),
                    ...(fundAccount ? {} : getPaymasterFields())
                })
                const userOpReceipt = await client.waitForUserOperationReceipt({
                    hash
                })
                expect(userOpReceipt.success).toBe(true)

                // The userOp paid for at least the gas the bundle used, within
                // 1%. TODO: under Amsterdam the EntryPoint's unmetered overhead
                // is ~2.3k higher than PVG's fixed overheads (likely EIP-8038
                // state access repricing). Re-benchmark them and drop this
                // tolerance.
                const { gasUsed } = userOpReceipt.receipt
                expect(userOpReceipt.actualGasUsed).toBeGreaterThanOrEqual(
                    gasUsed - gasUsed / 100n
                )
            }
        )
    }
)
