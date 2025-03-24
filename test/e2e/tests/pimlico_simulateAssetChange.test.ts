import { deepHexlify } from "permissionless"
import {
    createClient,
    http,
    parseEther,
    type Address,
    encodeFunctionData,
    erc721Abi,
    erc20Abi
} from "viem"
import {
    type EntryPointVersion,
    type UserOperation,
    entryPoint07Address
} from "viem/account-abstraction"
import { foundry } from "viem/chains"
import { beforeAll, beforeEach, describe, expect, inject, test } from "vitest"
import { deployMockERC721, mintERC721 } from "../src/mockERC721.js"
import { beforeEachCleanUp, getSmartAccountClient } from "../src/utils/index.js"
import { deployMockERC20, mintERC20 } from "../src/mockErc20.js"
import { privateKeyToAddress, generatePrivateKey } from "viem/accounts"

describe.each([
    {
        entryPoint: entryPoint07Address,
        entryPointVersion: "0.7" as EntryPointVersion
    }
])(
    "$entryPointVersion supports pimlico_simulateAssetChange for tokens",
    ({ entryPoint, entryPointVersion }) => {
        const anvilRpc = inject("anvilRpc")
        const altoRpc = inject("altoRpc")

        let mockERC721Address: Address
        let mockERC20Address: Address

        beforeAll(async () => {
            // Deploy mock ERC721 token
            mockERC721Address = await deployMockERC721({ anvilRpc })
            mockERC20Address = await deployMockERC20({ anvilRpc })
        })

        beforeEach(async () => {
            await beforeEachCleanUp({ anvilRpc, altoRpc })
        })

        test("Should detect ERC-721 transfers and approvals in user operation", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const erc721TokenId = 500n
            const spender = privateKeyToAddress(generatePrivateKey())
            const recipient = privateKeyToAddress(generatePrivateKey())

            await mintERC721({
                contractAddress: mockERC721Address,
                to: smartAccountClient.account.address,
                tokenId: erc721TokenId,
                anvilRpc
            })

            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: mockERC721Address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: erc721Abi,
                            functionName: "approve",
                            args: [spender, erc721TokenId]
                        })
                    },
                    {
                        to: mockERC721Address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: erc721Abi,
                            functionName: "transferFrom",
                            args: [
                                smartAccountClient.account.address,
                                recipient,
                                erc721TokenId
                            ]
                        })
                    }
                ]
            })

            const res = (await smartAccountClient.request({
                // @ts-ignore
                method: "pimlico_simulateAssetChange",
                params: [deepHexlify(userOp), entryPoint07Address]
            })) as any

            // Assert the response structure
            expect(res).toBeDefined()
            expect(Array.isArray(res.assetChanges)).toBe(true)
            expect(res.assetChanges.length).toBe(2) // Two operations: approve and transfer

            // Check approval operation
            const approveOperation = res.assetChanges[0]
            expect(approveOperation.assetType).toBe("ERC-721")
            expect(approveOperation.tokenAddress.toLowerCase()).toBe(
                mockERC721Address.toLowerCase()
            )
            expect(approveOperation.tokenId).toBe(erc721TokenId.toString())
            expect(approveOperation.owner.toLowerCase()).toBe(
                smartAccountClient.account.address.toLowerCase()
            )
            expect(approveOperation.spender.toLowerCase()).toBe(
                spender.toLowerCase()
            )
            expect(approveOperation.type).toBe("approval")

            // Check transfer operation
            const transferOperation = res.assetChanges[1]
            expect(transferOperation.assetType).toBe("ERC-721")
            expect(transferOperation.tokenAddress.toLowerCase()).toBe(
                mockERC721Address.toLowerCase()
            )
            expect(transferOperation.tokenId).toBe(erc721TokenId.toString())
            expect(transferOperation.from.toLowerCase()).toBe(
                smartAccountClient.account.address.toLowerCase()
            )
            expect(transferOperation.to.toLowerCase()).toBe(
                recipient.toLowerCase()
            )
            expect(transferOperation.type).toBe("transfer")
        })

        test("Should detect native token transfers in user operation", async () => {})

        test("Should detect ERC-20 transfers and approvals in user operation", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const erc20Amount = parseEther("1")
            const spender = privateKeyToAddress(generatePrivateKey())
            const recipient = privateKeyToAddress(generatePrivateKey())

            // Mint some ERC-20 tokens to the smart account
            await mintERC20({
                contractAddress: mockERC20Address,
                to: smartAccountClient.account.address,
                amount: erc20Amount,
                anvilRpc
            })

            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: mockERC20Address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: erc20Abi,
                            functionName: "approve",
                            args: [spender, erc20Amount]
                        })
                    },
                    {
                        to: mockERC20Address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: erc20Abi,
                            functionName: "transfer",
                            args: [recipient, erc20Amount]
                        })
                    }
                ]
            })

            const res = (await smartAccountClient.request({
                // @ts-ignore
                method: "pimlico_simulateAssetChange",
                params: [deepHexlify(userOp), entryPoint07Address]
            })) as any

            // Assert the response structure
            expect(res).toBeDefined()
            expect(Array.isArray(res.assetChanges)).toBe(true)
            expect(res.assetChanges.length).toBe(2) // Two operations: approve and transfer

            // Check approval operation
            const approveOperation = res.assetChanges[0]
            expect(approveOperation.assetType).toBe("ERC-20")
            expect(approveOperation.tokenAddress.toLowerCase()).toBe(
                mockERC20Address.toLowerCase()
            )
            expect(approveOperation.value).toBe(erc20Amount.toString())
            expect(approveOperation.owner.toLowerCase()).toBe(
                smartAccountClient.account.address.toLowerCase()
            )
            expect(approveOperation.spender.toLowerCase()).toBe(
                spender.toLowerCase()
            )
            expect(approveOperation.type).toBe("approval")

            // Check transfer operation
            const transferOperation = res.assetChanges[1]
            expect(transferOperation.assetType).toBe("ERC-20")
            expect(transferOperation.tokenAddress.toLowerCase()).toBe(
                mockERC20Address.toLowerCase()
            )
            expect(transferOperation.value).toBe(erc20Amount.toString())
            expect(transferOperation.from.toLowerCase()).toBe(
                smartAccountClient.account.address.toLowerCase()
            )
            expect(transferOperation.to.toLowerCase()).toBe(
                recipient.toLowerCase()
            )
            expect(transferOperation.type).toBe("transfer")
        })
    }
)
