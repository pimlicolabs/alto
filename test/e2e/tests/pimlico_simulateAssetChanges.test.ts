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
    "$entryPointVersion supports pimlico_simulateAssetChanges for tokens",
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

        test("Should detect ERC-721 transfers in user operation", async () => {
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
                method: "pimlico_simulateAssetChanges",
                params: [deepHexlify(userOp), entryPoint07Address]
            })) as any

            console.log(res)
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
                method: "pimlico_simulateAssetChanges",
                params: [deepHexlify(userOp), entryPoint07Address]
            })) as any

            console.log(res)
        })

        test("Should detect ERC-20 transfers in user operation", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const erc20Amount = parseEther("1")
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
                            functionName: "transfer",
                            args: [recipient, erc20Amount]
                        })
                    }
                ]
            })

            const res = (await smartAccountClient.request({
                // @ts-ignore
                method: "pimlico_simulateAssetChanges",
                params: [deepHexlify(userOp), entryPoint07Address]
            })) as any

            console.log(res)
        })
    }
)
