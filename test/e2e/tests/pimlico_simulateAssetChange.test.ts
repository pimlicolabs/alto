import { type SmartAccountClient } from "permissionless"
import {
    type Address,
    type Chain,
    type Hex,
    type Transport,
    createClient,
    http,
    parseEther,
    encodeFunctionData,
    erc20Abi
} from "viem"
import { generatePrivateKey } from "viem/accounts"
import { beforeAll, beforeEach, describe, expect, test, inject } from "vitest"
import {
    beforeEachCleanUp,
    getAnvilWalletClient,
    getPublicClient,
    getSmartAccountClient
} from "../src/utils/index.js"
import {
    type EntryPointVersion,
    type SmartAccount
} from "viem/account-abstraction"
import {
    deployErc20Token,
    sudoMintTokens,
    erc20Address
} from "../src/utils/erc20-utils.ts"

type AssetChange = {
    owner: Hex
    token: Hex
    diff: Hex
}

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

            // Fund the smart account with some ETH
            await anvilClient.sendTransaction({
                to: smartAccountClient.account.address,
                value: parseEther("1")
            })

            // Mint some tokens to the smart account
            await sudoMintTokens({
                amount: parseEther("100"),
                to: smartAccountClient.account.address,
                anvilRpc
            })

            await beforeEachCleanUp({ anvilRpc, altoRpc })
        })

        test("should simulate asset changes for ETH transfer", async () => {
            const recipient = "0x1234567890123456789012345678901234567890"
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
                    userOp,
                    entryPoint,
                    [smartAccountClient.account.address, recipient], // addresses to monitor
                    [] // no tokens to monitor (ETH only)
                ]
            })) as AssetChange[]

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)

            // Should have 2 entries for ETH changes
            expect(result.length).toBe(2)

            // Find the changes for sender and recipient
            const senderChange = result.find(
                (r) =>
                    r.owner.toLowerCase() ===
                    smartAccountClient.account.address.toLowerCase()
            )
            const recipientChange = result.find(
                (r) => r.owner.toLowerCase() === recipient.toLowerCase()
            )

            expect(senderChange).toBeDefined()
            expect(recipientChange).toBeDefined()

            // ETH is represented as 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
            expect(senderChange!.token).toBe(
                "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
            )
            expect(recipientChange!.token).toBe(
                "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
            )

            // Sender should have negative change (including gas fees)
            expect(BigInt(senderChange!.diff)).toBeLessThan(0n)

            // Recipient should have positive change
            expect(BigInt(recipientChange!.diff)).toBe(transferAmount)
        })

        test("should simulate asset changes for ERC20 transfer", async () => {
            const recipient = "0x1234567890123456789012345678901234567890"
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
                    userOp,
                    entryPoint,
                    [smartAccountClient.account.address, recipient], // addresses to monitor
                    [erc20Address] // monitor the ERC20 token
                ]
            })) as AssetChange[]

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)

            // Should have changes for both ETH (gas) and ERC20
            const erc20Changes = result.filter(
                (r) => r.token.toLowerCase() === erc20Address.toLowerCase()
            )
            const ethChanges = result.filter(
                (r) => r.token === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
            )

            // Verify ERC20 changes
            expect(erc20Changes.length).toBe(2)

            const senderErc20Change = erc20Changes.find(
                (r) =>
                    r.owner.toLowerCase() ===
                    smartAccountClient.account.address.toLowerCase()
            )
            const recipientErc20Change = erc20Changes.find(
                (r) => r.owner.toLowerCase() === recipient.toLowerCase()
            )

            expect(senderErc20Change).toBeDefined()
            expect(recipientErc20Change).toBeDefined()
            expect(BigInt(senderErc20Change!.diff)).toBe(-transferAmount)
            expect(BigInt(recipientErc20Change!.diff)).toBe(transferAmount)

            // Verify ETH changes (only sender pays gas)
            const senderEthChange = ethChanges.find(
                (r) =>
                    r.owner.toLowerCase() ===
                    smartAccountClient.account.address.toLowerCase()
            )
            expect(senderEthChange).toBeDefined()
            expect(BigInt(senderEthChange!.diff)).toBeLessThan(0n) // Gas fees
        })

        test("should simulate asset changes for multiple transfers", async () => {
            const recipient1 = "0x1234567890123456789012345678901234567890"
            const recipient2 = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
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

            // Call pimlico_simulateAssetChange
            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    userOp,
                    entryPoint,
                    [
                        smartAccountClient.account.address,
                        recipient1,
                        recipient2
                    ],
                    [erc20Address]
                ]
            })) as AssetChange[]

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)

            // Verify recipient1 received ETH
            const recipient1EthChange = result.find(
                (r) =>
                    r.owner.toLowerCase() === recipient1.toLowerCase() &&
                    r.token === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
            )
            expect(recipient1EthChange).toBeDefined()
            expect(BigInt(recipient1EthChange!.diff)).toBe(ethAmount)

            // Verify recipient2 received tokens
            const recipient2TokenChange = result.find(
                (r) =>
                    r.owner.toLowerCase() === recipient2.toLowerCase() &&
                    r.token.toLowerCase() === erc20Address.toLowerCase()
            )
            expect(recipient2TokenChange).toBeDefined()
            expect(BigInt(recipient2TokenChange!.diff)).toBe(tokenAmount)
        })

        test("should return empty array for no asset changes", async () => {
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

            // Call pimlico_simulateAssetChange
            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    userOp,
                    entryPoint,
                    [smartAccountClient.account.address],
                    []
                ]
            })) as AssetChange[]

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)

            // Should only have ETH change for gas
            const ethChanges = result.filter(
                (r) => r.token === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
            )
            expect(ethChanges.length).toBe(1)
            expect(ethChanges[0]!.owner.toLowerCase()).toBe(
                smartAccountClient.account.address.toLowerCase()
            )
            expect(BigInt(ethChanges[0]!.diff)).toBeLessThan(0n) // Only gas fees
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

            // Set gas limits to 0 to make it invalid
            userOp.verificationGasLimit = 0n
            userOp.callGasLimit = 0n

            // Call pimlico_simulateAssetChange and expect it to throw
            await expect(
                bundlerClient.request({
                    method: "pimlico_simulateAssetChange",
                    params: [
                        userOp,
                        entryPoint,
                        [smartAccountClient.account.address],
                        []
                    ]
                })
            ).rejects.toThrow()
        })

        test("should simulate asset changes with no monitored addresses", async () => {
            const recipient = "0x1234567890123456789012345678901234567890"
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
                    userOp,
                    entryPoint,
                    [], // no addresses to monitor
                    []
                ]
            })) as AssetChange[]

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)
            expect(result.length).toBe(0) // No changes reported when no addresses monitored
        })

        test("should simulate asset changes for contract interaction", async () => {
            // Create a user operation that interacts with the ERC20 contract
            // but doesn't actually transfer tokens (e.g., approve)
            const spender = "0x1234567890123456789012345678901234567890"
            const approveAmount = parseEther("50")

            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: erc20Address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: erc20Abi,
                            functionName: "approve",
                            args: [spender, approveAmount]
                        })
                    }
                ]
            })

            // Call pimlico_simulateAssetChange
            const result = (await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    userOp,
                    entryPoint,
                    [smartAccountClient.account.address, spender],
                    [erc20Address]
                ]
            })) as AssetChange[]

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)

            // Should only have ETH change for gas (no token transfer)
            const tokenChanges = result.filter(
                (r) => r.token.toLowerCase() === erc20Address.toLowerCase()
            )
            expect(tokenChanges.length).toBe(0) // No token balance changes

            const ethChanges = result.filter(
                (r) => r.token === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
            )
            expect(ethChanges.length).toBe(1)
            expect(BigInt(ethChanges[0]!.diff)).toBeLessThan(0n) // Only gas fees
        })
    }
)
