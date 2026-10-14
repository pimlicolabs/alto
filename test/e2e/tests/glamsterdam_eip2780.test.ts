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
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    inject,
    test
} from "vitest"
import { deployPaymaster, encodePaymasterData } from "../src/testPaymaster.js"
import { startAltoWithFlags } from "../src/utils/altoInstance.js"
import {
    beforeEachCleanUp,
    getPublicClient,
    getSimple7702AccountImplementationAddress,
    getSmartAccountClient
} from "../src/utils/index.js"

// EIP-8037 state gas charged for an EIP-7702 authorization under EIP-2780
const EIP8037_NEW_ACCOUNT_STATE_GAS = 183_600n
const EIP8037_AUTH_BASE_STATE_GAS = 35_190n
const FLAGGED_ALTO_PORT = 8091
// PVG also moves by a few gas when estimated gas limits change calldata bytes
const PVG_TOLERANCE = 500n

const anvilRpc = inject("anvilRpc")
const altoRpc = inject("altoRpc")

const expectWithin = (actual: bigint, expected: bigint) => {
    expect(actual).toBeGreaterThanOrEqual(expected - PVG_TOLERANCE)
    expect(actual).toBeLessThanOrEqual(expected + PVG_TOLERANCE)
}

let flaggedAlto: Awaited<ReturnType<typeof startAltoWithFlags>>

beforeAll(async () => {
    flaggedAlto = await startAltoWithFlags({
        anvilRpc,
        port: FLAGGED_ALTO_PORT,
        flags: {
            "supports-eip2780": true,
            // Unscaled PVG, so the deltas below are the raw state gas
            "v6-pre-verification-gas-limit-multiplier": "100",
            "v7-pre-verification-gas-limit-multiplier": "100"
        }
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
])(
    "$entryPointVersion with supports-eip2780",
    ({ entryPoint, entryPointVersion }) => {
        const publicClient = getPublicClient(anvilRpc)
        const anvilClient = createTestClient({
            chain: foundry,
            mode: "anvil",
            transport: http(anvilRpc)
        })
        const calls = [{ to: zeroAddress, data: "0x", value: 0n }] as const

        let paymaster: Address

        beforeEach(async () => {
            await beforeEachCleanUp({ anvilRpc, altoRpc })
            paymaster = await deployPaymaster({ entryPoint, anvilRpc })
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
                nonce: await publicClient.getTransactionCount({
                    address: owner.address
                }),
                contractAddress:
                    getSimple7702AccountImplementationAddress(entryPointVersion)
            })
        }

        test("PVG prices the EIP-7702 authorization by authority state", async () => {
            const privateKey = generatePrivateKey()
            const getClients = () =>
                Promise.all([
                    getSmartAccountClient({
                        entryPointVersion,
                        anvilRpc,
                        altoRpc,
                        privateKey,
                        use7702: true,
                        fundAccount: false
                    }),
                    getSmartAccountClient({
                        entryPointVersion,
                        anvilRpc,
                        altoRpc: flaggedAlto.altoRpc,
                        privateKey,
                        use7702: true,
                        fundAccount: false
                    })
                ])
            const estimatePvg = async () => {
                const [defaultClient, flaggedClient] = await getClients()
                const authorization = await signAuthorization(privateKey)
                const [defaultEstimate, flaggedEstimate] = await Promise.all([
                    defaultClient.estimateUserOperationGas({
                        calls: [...calls],
                        authorization,
                        ...getPaymasterFields()
                    }),
                    flaggedClient.estimateUserOperationGas({
                        calls: [...calls],
                        authorization,
                        ...getPaymasterFields()
                    })
                ])
                return {
                    defaultPvg: defaultEstimate.preVerificationGas,
                    flaggedPvg: flaggedEstimate.preVerificationGas
                }
            }

            // Authority has no nonce, balance or code: a new account
            const newAccount = await estimatePvg()

            // Same authority once it exists, but is not delegated yet
            await anvilClient.setBalance({
                address: privateKeyToAccount(privateKey).address,
                value: parseEther("100")
            })
            const existingAccount = await estimatePvg()

            expectWithin(newAccount.defaultPvg - existingAccount.defaultPvg, 0n)
            expectWithin(
                newAccount.flaggedPvg - existingAccount.flaggedPvg,
                EIP8037_NEW_ACCOUNT_STATE_GAS
            )

            // Delegate the authority on-chain, then estimate again
            const [, flaggedClient] = await getClients()
            const hash = await flaggedClient.sendUserOperation({
                calls: [...calls],
                authorization: await signAuthorization(privateKey),
                ...getPaymasterFields()
            })
            const receipt = await flaggedClient.waitForUserOperationReceipt({
                hash
            })
            expect(receipt.success).toBe(true)

            const delegatedAccount = await estimatePvg()

            expectWithin(
                existingAccount.defaultPvg - delegatedAccount.defaultPvg,
                0n
            )
            expectWithin(
                existingAccount.flaggedPvg - delegatedAccount.flaggedPvg,
                EIP8037_AUTH_BASE_STATE_GAS
            )
        })

        test("PVG covers the mined bundle's gas for a 7702 userOp", async () => {
            const privateKey = generatePrivateKey()
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc: flaggedAlto.altoRpc,
                privateKey,
                use7702: true
            })

            const hash = await smartAccountClient.sendUserOperation({
                calls: [...calls],
                authorization: await signAuthorization(privateKey)
            })
            const userOpReceipt =
                await smartAccountClient.waitForUserOperationReceipt({ hash })
            expect(userOpReceipt.success).toBe(true)

            // The userOp paid for at least the gas the bundle used on-chain
            expect(userOpReceipt.actualGasUsed).toBeGreaterThanOrEqual(
                userOpReceipt.receipt.gasUsed
            )
        })
    }
)
