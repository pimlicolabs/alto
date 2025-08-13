import { type SmartAccountClient, deepHexlify } from "permissionless"
import {
    http,
    type Address,
    type Chain,
    type Hex,
    type Transport,
    createClient,
    encodeFunctionData,
    erc20Abi,
    parseEther,
    toHex
} from "viem"
import type { EntryPointVersion, SmartAccount } from "viem/account-abstraction"
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"
import { beforeAll, beforeEach, describe, expect, inject, test } from "vitest"
import {
    deployErc20Token,
    erc20Address,
    sudoMintTokens
} from "../src/utils/erc20-utils.ts"
import {
    beforeEachCleanUp,
    getAnvilWalletClient,
    getPublicClient,
    getSmartAccountClient
} from "../src/utils/index.js"

type BalanceChange = {
    token: Hex
    owner: Hex
    balanceBefore: number
    balanceAfter: number
}

type AllowanceChange = {
    token: Hex
    owner: Hex
    spender: Hex
    allowanceBefore: number
    allowanceAfter: number
}

type SimulateAssetChangeResult = {
    balanceChanges: BalanceChange[]
    allowanceChanges: AllowanceChange[]
}

const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"

describe.each([
    { entryPointVersion: "0.6" as EntryPointVersion },
    { entryPointVersion: "0.7" as EntryPointVersion },
    { entryPointVersion: "0.8" as EntryPointVersion }
])(
    "$entryPointVersion supports pimlico_simulateAssetChange",
    ({ entryPointVersion }) => {
        let smartAccountClient: SmartAccountClient<
            Transport,
            Chain | undefined,
            SmartAccount
        >
        let owner: Hex
        const altoRpc = inject("altoRpc")
        const anvilRpc = inject("anvilRpc")
        let entryPoint: Address
        let bundlerClient: ReturnType<typeof createClient>

        beforeAll(async () => {
            bundlerClient = createClient({
                transport: http(altoRpc)
            })
        })

        beforeEach(async () => {
            owner = generatePrivateKey()
            smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                privateKey: owner,
                anvilRpc,
                altoRpc
            })
            entryPoint = smartAccountClient.account.entryPoint.address

            // Deploy a test ERC20 token
            const publicClient = getPublicClient(anvilRpc)
            const anvilClient = getAnvilWalletClient({
                addressIndex: 0,
                anvilRpc
            })

            await deployErc20Token(anvilClient, publicClient)

            // Mint some tokens to the smart account
            await sudoMintTokens({
                amount: parseEther("100"),
                to: smartAccountClient.account.address,
                anvilRpc
            })

            await beforeEachCleanUp({ anvilRpc, altoRpc })
        })

        test("should simulate asset changes for ETH transfer", async () => {
            const recipient = privateKeyToAddress(generatePrivateKey())
            const transferAmount = parseEther("0.1")

            // Create a user operation that transfers ETH
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: recipient,
                        value: transferAmount,
                        data: "0x"
                    }
                ]
            })

            // Call pimlico_simulateAssetChange
            const balanceQueries = [
                {
                    token: NATIVE_TOKEN_ADDRESS,
                    owner: smartAccountClient.account.address
                },
                { token: NATIVE_TOKEN_ADDRESS, owner: recipient }
            ]
            const allowanceQueries = []

            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    balanceQueries,
                    allowanceQueries
                ]
            })) as SimulateAssetChangeResult

            expect(result.balanceChanges.length).toBe(2)

            // Find the changes for sender and recipient
            const senderChange = result.balanceChanges.find(
                (r) => r.owner === smartAccountClient.account.address
            ) as BalanceChange
            const recipientChange = result.balanceChanges.find(
                (r) => r.owner === recipient
            ) as BalanceChange

            expect(senderChange.token).toBe(NATIVE_TOKEN_ADDRESS)
            expect(recipientChange.token).toBe(NATIVE_TOKEN_ADDRESS)

            // Sender should have negative change (including gas fees)
            expect(
                senderChange.balanceAfter - senderChange.balanceBefore
            ).toBeLessThan(-Number(transferAmount))

            // Recipient should have positive change
            expect(
                recipientChange.balanceAfter - recipientChange.balanceBefore
            ).toBe(Number(transferAmount))
        })

        test("should simulate allowance changes for ERC20 approval", async () => {
            const spender = privateKeyToAddress(generatePrivateKey())
            const approvalAmount = parseEther("50")

            // Create a user operation that approves ERC20 tokens
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: erc20Address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: erc20Abi,
                            functionName: "approve",
                            args: [spender, approvalAmount]
                        })
                    }
                ]
            })

            // Call pimlico_simulateAssetChange with allowance tracking
            const balanceQueries = []
            const allowanceQueries = [
                {
                    token: erc20Address,
                    owner: smartAccountClient.account.address,
                    spender: spender
                }
            ]

            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    balanceQueries,
                    allowanceQueries
                ]
            })) as SimulateAssetChangeResult

            expect(result.allowanceChanges.length).toBe(1)
            expect(result.balanceChanges.length).toBe(0) // No balance changes for approval

            const allowanceChange = result
                .allowanceChanges[0] as AllowanceChange
            expect(allowanceChange).toMatchObject({
                token: erc20Address,
                owner: smartAccountClient.account.address,
                spender: spender,
                allowanceBefore: 0,
                allowanceAfter: Number(approvalAmount)
            })
        })

        test("should simulate asset changes for ERC20 transfer", async () => {
            const recipient = privateKeyToAddress(generatePrivateKey())
            const transferAmount = parseEther("10")

            // Create a user operation that transfers ERC20 tokens
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: erc20Address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: erc20Abi,
                            functionName: "transfer",
                            args: [recipient, transferAmount]
                        })
                    }
                ]
            })

            // Call pimlico_simulateAssetChange
            const balanceQueries = [
                {
                    token: erc20Address,
                    owner: smartAccountClient.account.address
                },
                { token: erc20Address, owner: recipient }
            ]
            const allowanceQueries = []

            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    balanceQueries,
                    allowanceQueries
                ]
            })) as SimulateAssetChangeResult

            expect(result.balanceChanges.length).toBe(2)

            const senderErc20Change = result.balanceChanges.find(
                (r) => r.owner === smartAccountClient.account.address
            ) as BalanceChange
            const recipientErc20Change = result.balanceChanges.find(
                (r) => r.owner === recipient
            ) as BalanceChange

            expect(senderErc20Change.token).toBe(erc20Address)
            expect(recipientErc20Change.token).toBe(erc20Address)
            const senderErc20Diff =
                senderErc20Change.balanceAfter - senderErc20Change.balanceBefore
            expect(senderErc20Diff).toBe(-Number(transferAmount))
            const recipientErc20Diff =
                recipientErc20Change.balanceAfter -
                recipientErc20Change.balanceBefore
            expect(recipientErc20Diff).toBe(Number(transferAmount))
        })

        test("should simulate asset changes for ETH and ERC20 tranfers", async () => {
            const recipient1 = privateKeyToAddress(generatePrivateKey())
            const recipient2 = privateKeyToAddress(generatePrivateKey())
            const ethAmount = parseEther("0.05")
            const tokenAmount = parseEther("5")

            // Create a user operation with multiple transfers
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: recipient1,
                        value: ethAmount,
                        data: "0x"
                    },
                    {
                        to: erc20Address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: erc20Abi,
                            functionName: "transfer",
                            args: [recipient2, tokenAmount]
                        })
                    }
                ]
            })

            // Call pimlico_simulateAssetChange with both ETH and ERC20 tracking
            const balanceQueries = [
                {
                    token: NATIVE_TOKEN_ADDRESS,
                    owner: smartAccountClient.account.address
                },
                { token: NATIVE_TOKEN_ADDRESS, owner: recipient1 },
                { token: NATIVE_TOKEN_ADDRESS, owner: recipient2 },
                {
                    token: erc20Address,
                    owner: smartAccountClient.account.address
                },
                { token: erc20Address, owner: recipient1 },
                { token: erc20Address, owner: recipient2 }
            ]
            const allowanceQueries = []

            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    balanceQueries,
                    allowanceQueries
                ]
            })) as SimulateAssetChangeResult

            // Filter out zero-value changes
            const nonZeroChanges = result.balanceChanges.filter((r) => {
                const diff = r.balanceAfter - r.balanceBefore
                return diff !== 0
            })

            // Should have 4 non-zero changes:
            // 1. Sender ETH change (sent ETH + gas)
            // 2. Recipient1 ETH change (received ETH)
            // 3. Sender ERC20 change (sent tokens)
            // 4. Recipient2 ERC20 change (received tokens)
            if (entryPointVersion !== "0.6") {
                expect(nonZeroChanges.length).toBe(4)

                // Verify recipient1 received ETH
                const recipient1EthChange = result.balanceChanges.find(
                    (r) =>
                        r.owner === recipient1 &&
                        r.token === NATIVE_TOKEN_ADDRESS
                ) as BalanceChange
                const recipient1Diff =
                    recipient1EthChange.balanceAfter -
                    recipient1EthChange.balanceBefore
                expect(recipient1Diff).toBe(Number(ethAmount))

                // Verify recipient2 received tokens
                const recipient2TokenChange = result.balanceChanges.find(
                    (r) => r.owner === recipient2 && r.token === erc20Address
                ) as BalanceChange
                const recipient2Diff =
                    recipient2TokenChange.balanceAfter -
                    recipient2TokenChange.balanceBefore
                expect(recipient2Diff).toBe(Number(tokenAmount))

                // Verify sender's ERC20 change (sent tokens)
                const senderErc20Change = result.balanceChanges.find(
                    (r) =>
                        r.owner === smartAccountClient.account.address &&
                        r.token === erc20Address
                ) as BalanceChange
                const senderErc20Diff =
                    senderErc20Change.balanceAfter -
                    senderErc20Change.balanceBefore
                expect(senderErc20Diff).toBe(-Number(tokenAmount))

                // Verify sender's ETH change (sent ETH + gas fees)
                const senderEthChange = result.balanceChanges.find(
                    (r) =>
                        r.owner === smartAccountClient.account.address &&
                        r.token === NATIVE_TOKEN_ADDRESS
                ) as BalanceChange
                const senderEthDiff =
                    senderEthChange.balanceAfter - senderEthChange.balanceBefore
                expect(senderEthDiff).toBeLessThan(-Number(ethAmount)) // Should be more negative than just ethAmount due to gas
            } else {
                // SimpleAccount 0.6 does not support sending ETH when calling executeBatch
                // Source: https://github.com/eth-infinitism/account-abstraction/blob/fa6129/contracts/samples/SimpleAccount.sol#L62-L71
                //
                // Should have 3 non-zero changes:
                // 1. Sender ETH change (gas)
                // 2. Sender ERC20 change (sent tokens)
                // 3. Recipient2 ERC20 change (received tokens)
                expect(nonZeroChanges.length).toBe(3)

                // Verify recipient2 received tokens
                const recipient2TokenChange = result.balanceChanges.find(
                    (r) => r.owner === recipient2 && r.token === erc20Address
                ) as BalanceChange
                const recipient2Diff =
                    recipient2TokenChange.balanceAfter -
                    recipient2TokenChange.balanceBefore
                expect(recipient2Diff).toBe(Number(tokenAmount))

                // Verify sender's ERC20 change (sent tokens)
                const senderErc20Change = result.balanceChanges.find(
                    (r) =>
                        r.owner === smartAccountClient.account.address &&
                        r.token === erc20Address
                ) as BalanceChange
                const senderErc20Diff =
                    senderErc20Change.balanceAfter -
                    senderErc20Change.balanceBefore
                expect(senderErc20Diff).toBe(-Number(tokenAmount))

                // Verify sender's ETH change (only gas fees, no ETH transfer)
                const senderEthChange = result.balanceChanges.find(
                    (r) =>
                        r.owner === smartAccountClient.account.address &&
                        r.token === NATIVE_TOKEN_ADDRESS
                ) as BalanceChange
                const senderEthDiff =
                    senderEthChange.balanceAfter - senderEthChange.balanceBefore
                expect(senderEthDiff).toBeLessThan(0) // Only gas fees
            }
        })

        test("should return empty array when tracking no tokens", async () => {
            // Create a user operation that doesn't transfer any assets
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: smartAccountClient.account.address,
                        value: 0n,
                        data: "0x" // Empty call to self
                    }
                ]
            })

            // Call pimlico_simulateAssetChange without tracking ETH
            const balanceQueries = []
            const allowanceQueries = []

            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    balanceQueries,
                    allowanceQueries
                ]
            })) as SimulateAssetChangeResult

            expect(result.balanceChanges.length).toBe(0)
            expect(result.allowanceChanges.length).toBe(0)
        })

        test("should simulate asset changes with no monitored addresses", async () => {
            const recipient = privateKeyToAddress(generatePrivateKey())
            const transferAmount = parseEther("0.1")

            // Create a user operation that transfers ETH
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: recipient,
                        value: transferAmount,
                        data: "0x"
                    }
                ]
            })

            // Call pimlico_simulateAssetChange with empty addresses array
            const balanceQueries = []
            const allowanceQueries = []

            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    balanceQueries,
                    allowanceQueries
                ]
            })) as SimulateAssetChangeResult

            expect(result.balanceChanges.length).toBe(0) // No changes reported when no addresses monitored
            expect(result.allowanceChanges.length).toBe(0)
        })

        test("should handle invalid user operation", async () => {
            // Create an invalid user operation with insufficient gas
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: "0x1234567890123456789012345678901234567890",
                        value: parseEther("0.1"),
                        data: "0x"
                    }
                ]
            })

            // Force a AA25 error by incrementing the nonce
            userOp.nonce = userOp.nonce + 1n

            // Call pimlico_simulateAssetChange and expect it to throw with AA25 error
            const balanceQueries = [
                {
                    token: NATIVE_TOKEN_ADDRESS,
                    owner: smartAccountClient.account.address
                }
            ]
            const allowanceQueries = []

            await expect(
                bundlerClient.request({
                    method: "pimlico_simulateAssetChange",
                    params: [
                        deepHexlify(userOp),
                        entryPoint,
                        balanceQueries,
                        allowanceQueries
                    ]
                })
            ).rejects.toThrow(
                "UserOperation reverted during simulation with reason: AA25 invalid account nonce"
            )
        })

        test("should simulate asset changes with state overrides", async () => {
            const recipient = privateKeyToAddress(generatePrivateKey())
            const transferAmount = parseEther("0.1")

            // Create local smart account client with no ETH balance.
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                privateKey: owner,
                anvilRpc,
                altoRpc,
                fundAccount: false
            })

            // State override to give the recipient some ETH balance
            const recipientInitialBalance = toHex(parseEther("5"), { size: 32 })
            const stateOverrides = {
                [recipient]: {
                    balance: recipientInitialBalance
                }
            }

            // Create a user operation that transfers ETH
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: recipient,
                        value: transferAmount,
                        data: "0x"
                    }
                ]
            })

            // Call pimlico_simulateAssetChange with state overrides and ETH tracking
            const balanceQueries = [
                {
                    token: NATIVE_TOKEN_ADDRESS,
                    owner: smartAccountClient.account.address
                },
                { token: NATIVE_TOKEN_ADDRESS, owner: recipient }
            ]
            const allowanceQueries = []

            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    balanceQueries,
                    allowanceQueries,
                    stateOverrides
                ]
            })) as SimulateAssetChangeResult

            // Find the changes for sender and recipient
            const recipientChange = result.balanceChanges.find(
                (r) => r.owner === recipient
            ) as BalanceChange
            const senderChange = result.balanceChanges.find(
                (r) => r.owner === smartAccountClient.account.address
            ) as BalanceChange

            expect(recipientChange.token).toBe(NATIVE_TOKEN_ADDRESS)
            expect(senderChange.token).toBe(NATIVE_TOKEN_ADDRESS)

            // Recipient should receive the transfer amount
            // (state override balance doesn't affect the diff calculation)
            expect(
                recipientChange.balanceAfter - recipientChange.balanceBefore
            ).toBe(Number(transferAmount))
            // Sender should have negative change (transfer + gas)
            expect(
                senderChange.balanceAfter - senderChange.balanceBefore
            ).toBeLessThan(-Number(transferAmount))
        })
    }
)
