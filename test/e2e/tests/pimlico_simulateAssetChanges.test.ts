import { deepHexlify } from "permissionless"
import {
    parseEther,
    type Address,
    encodeFunctionData,
    erc721Abi,
    erc20Abi,
    parseUnits
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
                altoRpc,
                privateKey:
                    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            })

            const erc721TokenId = 500n
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

            expect(res).toEqual({
                assetChanges: [
                    {
                        token: {
                            tokenType: "ERC-721",
                            address:
                                "0xB791449A543E19362BBEfEec30F4116a6b0be9C5",
                            tokenId: "0x1f4",
                            name: "TEST NFT",
                            symbol: "TEST"
                        },
                        value: {
                            diff: "-1",
                            pre: "1",
                            post: "0"
                        }
                    }
                ]
            })
        })

        test("Should detect native token transfers in user operation", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const nativeAmount = parseEther("0.1") // 0.01 ETH
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

            expect(res).toEqual({
                assetChanges: [
                    {
                        token: {
                            tokenType: "NATIVE"
                        },
                        value: {
                            pre: "100000000000000000000",
                            post: "99900000000000000000",
                            diff: "-100000000000000000"
                        }
                    }
                ]
            })
        })

        test("Should detect ERC-20 transfers in user operation", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const mintAmount = parseUnits("0.5", 6)
            const amountToSend = parseUnits("0.1", 6)
            const recipient = privateKeyToAddress(generatePrivateKey())

            // Mint some ERC-20 tokens to the smart account
            await mintERC20({
                contractAddress: mockERC20Address,
                to: smartAccountClient.account.address,
                amount: mintAmount,
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
                            args: [recipient, amountToSend]
                        })
                    }
                ]
            })

            const res = (await smartAccountClient.request({
                // @ts-ignore
                method: "pimlico_simulateAssetChanges",
                params: [deepHexlify(userOp), entryPoint07Address]
            })) as any

            expect(res).toEqual({
                assetChanges: [
                    {
                        token: {
                            tokenType: "ERC-20",
                            address: mockERC20Address,
                            decimals: 6,
                            name: "TEST TOKEN",
                            symbol: "TEST"
                        },
                        value: {
                            diff: "-100000",
                            post: "400000",
                            pre: "500000"
                        }
                    }
                ]
            })
        })
    }
)
