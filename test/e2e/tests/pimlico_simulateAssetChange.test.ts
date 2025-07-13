import { deepHexlify, type SmartAccountClient } from "permissionless"
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

type AssetChange = {
    owner: Hex
    token: Hex
    diff: number
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
            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    [smartAccountClient.account.address, recipient],
                    [NATIVE_TOKEN_ADDRESS]
                ]
            })) as AssetChange[]

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)

            // Should have 2 entries for ETH changes
            expect(result.length).toBe(2)

            // Find the changes for sender and recipient
            const senderChange = result.find(
                (r) => r.owner === smartAccountClient.account.address
            )
            const recipientChange = result.find((r) => r.owner === recipient)

            expect(senderChange).toBeDefined()
            expect(recipientChange).toBeDefined()

            expect(senderChange!.token).toBe(NATIVE_TOKEN_ADDRESS)
            expect(recipientChange!.token).toBe(NATIVE_TOKEN_ADDRESS)

            // Sender should have negative change (including gas fees)
            expect(senderChange!.diff).toBeLessThan(-Number(transferAmount))

            // Recipient should have positive change
            expect(recipientChange!.diff).toBe(Number(transferAmount))
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
            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    [smartAccountClient.account.address, recipient], // addresses to monitor
                    [erc20Address] // monitor only the ERC20 token, not ETH
                ]
            })) as AssetChange[]

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)

            // Verify ERC20 changes
            expect(result.length).toBe(2)

            const senderErc20Change = result.find(
                (r) => r.owner === smartAccountClient.account.address
            )
            const recipientErc20Change = result.find(
                (r) => r.owner === recipient
            )

            expect(senderErc20Change).toBeDefined()
            expect(recipientErc20Change).toBeDefined()
            expect(senderErc20Change!.token).toBe(erc20Address)
            expect(recipientErc20Change!.token).toBe(erc20Address)
            expect(senderErc20Change!.diff).toBe(-Number(transferAmount))
            expect(recipientErc20Change!.diff).toBe(Number(transferAmount))
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
            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    [
                        smartAccountClient.account.address,
                        recipient1,
                        recipient2
                    ],
                    [NATIVE_TOKEN_ADDRESS, erc20Address] // Track both ETH and ERC20
                ]
            })) as AssetChange[]

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)

            // Filter out zero-value changes
            const nonZeroChanges = result.filter((r) => r.diff !== 0)

            // Should have 4 non-zero changes:
            // 1. Sender ETH change (sent ETH + gas)
            // 2. Recipient1 ETH change (received ETH)
            // 3. Sender ERC20 change (sent tokens)
            // 4. Recipient2 ERC20 change (received tokens)
            if (entryPointVersion !== "0.6") {
                expect(nonZeroChanges.length).toBe(4)

                // Verify recipient1 received ETH
                const recipient1EthChange = result.find(
                    (r) =>
                        r.owner === recipient1 &&
                        r.token === NATIVE_TOKEN_ADDRESS
                )
                expect(recipient1EthChange).toBeDefined()
                expect(recipient1EthChange!.diff).toBe(Number(ethAmount))

                // Verify recipient2 received tokens
                const recipient2TokenChange = result.find(
                    (r) => r.owner === recipient2 && r.token === erc20Address
                )
                expect(recipient2TokenChange).toBeDefined()
                expect(recipient2TokenChange!.diff).toBe(Number(tokenAmount))

                // Verify sender's ERC20 change (sent tokens)
                const senderErc20Change = result.find(
                    (r) =>
                        r.owner === smartAccountClient.account.address &&
                        r.token === erc20Address
                )
                expect(senderErc20Change).toBeDefined()
                expect(senderErc20Change!.diff).toBe(-Number(tokenAmount))

                // Verify sender's ETH change (sent ETH + gas fees)
                const senderEthChange = result.find(
                    (r) =>
                        r.owner === smartAccountClient.account.address &&
                        r.token === NATIVE_TOKEN_ADDRESS
                )
                expect(senderEthChange).toBeDefined()
                expect(senderEthChange!.diff).toBeLessThan(-Number(ethAmount)) // Should be more negative than just ethAmount due to gas
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
                const recipient2TokenChange = result.find(
                    (r) => r.owner === recipient2 && r.token === erc20Address
                )
                expect(recipient2TokenChange).toBeDefined()
                expect(recipient2TokenChange!.diff).toBe(Number(tokenAmount))

                // Verify sender's ERC20 change (sent tokens)
                const senderErc20Change = result.find(
                    (r) =>
                        r.owner === smartAccountClient.account.address &&
                        r.token === erc20Address
                )
                expect(senderErc20Change).toBeDefined()
                expect(senderErc20Change!.diff).toBe(-Number(tokenAmount))

                // Verify sender's ETH change (only gas fees, no ETH transfer)
                const senderEthChange = result.find(
                    (r) =>
                        r.owner === smartAccountClient.account.address &&
                        r.token === NATIVE_TOKEN_ADDRESS
                )
                expect(senderEthChange).toBeDefined()
                expect(senderEthChange!.diff).toBeLessThan(0) // Only gas fees
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
            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    [smartAccountClient.account.address],
                    []
                ]
            })) as AssetChange[]

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)

            // Should be empty since we're not tracking any changes
            expect(result.length).toBe(0)
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
            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    [], // no addresses to monitor
                    []
                ]
            })) as AssetChange[]

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)
            expect(result.length).toBe(0) // No changes reported when no addresses monitored
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

            // Force a AA25 error
            userOp.nonce = userOp.nonce + 1n

            // Call pimlico_simulateAssetChange and expect it to throw
            await expect(
                bundlerClient.request({
                    method: "pimlico_simulateAssetChange",
                    params: [
                        deepHexlify(userOp),
                        entryPoint,
                        [smartAccountClient.account.address],
                        []
                    ]
                })
            ).rejects.toThrow()
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
            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    deepHexlify(userOp),
                    entryPoint,
                    [smartAccountClient.account.address, recipient],
                    [NATIVE_TOKEN_ADDRESS], // Track ETH transfers
                    stateOverrides
                ]
            })) as AssetChange[]

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)

            // Find the changes for sender and recipient
            const recipientChange = result.find((r) => r.owner === recipient)
            const senderChange = result.find(
                (r) => r.owner === smartAccountClient.account.address
            )

            expect(recipientChange).toBeDefined()
            expect(recipientChange!.token).toBe(NATIVE_TOKEN_ADDRESS)
            expect(senderChange).toBeDefined()
            expect(senderChange!.token).toBe(NATIVE_TOKEN_ADDRESS)

            // Recipient should receive the transfer amount
            // (state override balance doesn't affect the diff calculation)
            expect(recipientChange!.diff).toBe(Number(transferAmount))
            // Sender should have negative change (transfer + gas)
            expect(senderChange!.diff).toBeLessThan(-Number(transferAmount))
        })
    }
)
