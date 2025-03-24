import { deepHexlify } from "permissionless"
import {
    parseEther,
    type Address,
    encodeFunctionData,
    erc721Abi,
    erc20Abi,
    getAddress,
    fromHex
} from "viem"
import {
    type EntryPointVersion,
    entryPoint07Address
} from "viem/account-abstraction"
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
    "$entryPointVersion supports pimlico_traceTokenEvents for tokens",
    ({ entryPointVersion }) => {
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
            const mockSpender = privateKeyToAddress(generatePrivateKey())
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
                            args: [mockSpender, erc721TokenId]
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
                method: "pimlico_traceTokenEvents",
                params: [deepHexlify(userOp), entryPoint07Address]
            })) as any

            // Assert the response structure
            expect(res).toBeDefined()
            expect(Array.isArray(res.tokenEvents)).toBe(true)
            expect(res.tokenEvents.length).toBe(2) // Two operations: approve and transfer

            // Check approval operation
            const approveOperation = res.tokenEvents[0]
            const assetType = approveOperation.assetType
            const tokenAddress = getAddress(approveOperation.tokenAddress)
            const tokenId = fromHex(approveOperation.tokenId, "bigint")
            const owner = getAddress(approveOperation.owner)
            const spender = getAddress(approveOperation.spender)
            const type = approveOperation.type

            expect(assetType).toBe("ERC-721")
            expect(tokenAddress).toBe(mockERC721Address)
            expect(tokenId).toBe(erc721TokenId)
            expect(owner).toBe(smartAccountClient.account.address)
            expect(spender).toBe(mockSpender)
            expect(type).toBe("approval")
            
            // Check metadata fields exist (actual values depend on mock implementation)
            expect(approveOperation).toHaveProperty("name")
            expect(approveOperation).toHaveProperty("symbol")

            // Check transfer operation
            const transferOperation = res.tokenEvents[1]
            const transferAssetType = transferOperation.assetType
            const transferTokenAddress = getAddress(
                transferOperation.tokenAddress
            )
            const transferTokenId = fromHex(transferOperation.tokenId, "bigint")
            const transferFrom = getAddress(transferOperation.from)
            const transferTo = getAddress(transferOperation.to)
            const transferType = transferOperation.type

            expect(transferAssetType).toBe("ERC-721")
            expect(transferTokenAddress).toBe(mockERC721Address)
            expect(transferTokenId).toBe(erc721TokenId)
            expect(transferFrom).toBe(smartAccountClient.account.address)
            expect(transferTo).toBe(recipient)
            expect(transferType).toBe("transfer")
            
            // Check metadata fields exist (actual values depend on mock implementation)
            expect(transferOperation).toHaveProperty("name")
            expect(transferOperation).toHaveProperty("symbol")
        })

        test("Should detect ERC-721 ApprovalForAll events in user operation", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const operator = privateKeyToAddress(generatePrivateKey())
            const approved = true

            const tokenId = 999n
            await mintERC721({
                contractAddress: mockERC721Address,
                to: smartAccountClient.account.address,
                tokenId,
                anvilRpc
            })

            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: mockERC721Address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: erc721Abi,
                            functionName: "setApprovalForAll",
                            args: [operator, approved]
                        })
                    }
                ]
            })

            const res = (await smartAccountClient.request({
                // @ts-ignore
                method: "pimlico_traceTokenEvents",
                params: [deepHexlify(userOp), entryPoint07Address]
            })) as any

            // Assert the response structure
            expect(res).toBeDefined()
            expect(Array.isArray(res.tokenEvents)).toBe(true)
            expect(res.tokenEvents.length).toBe(1) // One operation: approvalForAll

            // Check approvalForAll operation
            const approvalForAllOperation = res.tokenEvents[0]
            const assetType = approvalForAllOperation.assetType
            const tokenAddress = getAddress(
                approvalForAllOperation.tokenAddress
            )
            const owner = getAddress(approvalForAllOperation.owner)
            const operatorAddress = getAddress(approvalForAllOperation.operator)
            const isApproved = approvalForAllOperation.approved
            const type = approvalForAllOperation.type

            expect(assetType).toBe("ERC-721")
            expect(tokenAddress).toBe(mockERC721Address)
            expect(owner).toBe(smartAccountClient.account.address)
            expect(operatorAddress).toBe(operator)
            expect(isApproved).toBe(approved)
            expect(type).toBe("approvalForAll")
            
            // Check metadata fields exist (actual values depend on mock implementation)
            expect(approvalForAllOperation).toHaveProperty("name")
            expect(approvalForAllOperation).toHaveProperty("symbol")
        })

        test("Should detect native token transfers in user operation", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const nativeAmount = parseEther("0.01") // 0.01 ETH
            const recipient = privateKeyToAddress(generatePrivateKey())

            // Create a user operation that sends native tokens
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: recipient,
                        value: nativeAmount,
                        data: "0x" // Empty data for a simple native transfer
                    }
                ]
            })

            const res = (await smartAccountClient.request({
                // @ts-ignore
                method: "pimlico_traceTokenEvents",
                params: [deepHexlify(userOp), entryPoint07Address]
            })) as any

            // Assert the response structure
            expect(res).toBeDefined()
            expect(Array.isArray(res.tokenEvents)).toBe(true)
            expect(res.tokenEvents.length).toBe(1) // One native transfer

            // Check native transfer operation
            const transferOperation = res.tokenEvents[0]
            const assetType = transferOperation.assetType
            const from = getAddress(transferOperation.from)
            const to = getAddress(transferOperation.to)
            const value = fromHex(transferOperation.value, "bigint")
            const type = transferOperation.type

            expect(assetType).toBe("NATIVE")
            expect(from).toBe(smartAccountClient.account.address)
            expect(to).toBe(recipient)
            expect(value).toBe(nativeAmount)
            expect(type).toBe("transfer")
        })

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
                method: "pimlico_traceTokenEvents",
                params: [deepHexlify(userOp), entryPoint07Address]
            })) as any

            // Assert the response structure
            expect(res).toBeDefined()
            expect(Array.isArray(res.tokenEvents)).toBe(true)
            expect(res.tokenEvents.length).toBe(2) // Two operations: approve and transfer

            // Check approval operation
            const approveOperation = res.tokenEvents[0]
            const approveAssetType = approveOperation.assetType
            const approveTokenAddress = getAddress(
                approveOperation.tokenAddress
            )
            const approveValue = fromHex(approveOperation.value, "bigint")
            const approveOwner = getAddress(approveOperation.owner)
            const approveSpender = getAddress(approveOperation.spender)
            const approveType = approveOperation.type

            expect(approveAssetType).toBe("ERC-20")
            expect(approveTokenAddress).toBe(mockERC20Address)
            expect(approveValue).toBe(erc20Amount)
            expect(approveOwner).toBe(smartAccountClient.account.address)
            expect(approveSpender).toBe(spender)
            expect(approveType).toBe("approval")
            
            // Check metadata fields exist (actual values depend on mock implementation)
            expect(approveOperation).toHaveProperty("name")
            expect(approveOperation).toHaveProperty("symbol")
            expect(approveOperation).toHaveProperty("decimals")

            // Check transfer operation
            const transferOperation = res.tokenEvents[1]
            const transferAssetType = transferOperation.assetType
            const transferTokenAddress = getAddress(
                transferOperation.tokenAddress
            )
            const transferValue = fromHex(transferOperation.value, "bigint")
            const transferFrom = getAddress(transferOperation.from)
            const transferTo = getAddress(transferOperation.to)
            const transferType = transferOperation.type

            expect(transferAssetType).toBe("ERC-20")
            expect(transferTokenAddress).toBe(mockERC20Address)
            expect(transferValue).toBe(erc20Amount)
            expect(transferFrom).toBe(smartAccountClient.account.address)
            expect(transferTo).toBe(recipient)
            expect(transferType).toBe("transfer")
            
            // Check metadata fields exist (actual values depend on mock implementation)
            expect(transferOperation).toHaveProperty("name")
            expect(transferOperation).toHaveProperty("symbol")
            expect(transferOperation).toHaveProperty("decimals")
        })
    }
)
