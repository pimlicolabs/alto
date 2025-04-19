import { http, createTestClient } from "viem"
import {
    UserOperationNotFoundError,
    UserOperationReceiptNotFoundError,
    entryPoint06Address,
    entryPoint07Address
} from "viem/account-abstraction"
import { foundry } from "viem/chains"
import { beforeEach, describe, expect, inject, test } from "vitest"
import {
    beforeEachCleanUp,
    getPimlicoClient,
    getSmartAccountClient
} from "../src/utils/index.js"
import { EntryPointVersion, entryPoint08Address } from "../src/constants.js"

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
    }
])(
    "$entryPointVersion supports eth_getUserOperationByHash",
    ({ entryPoint, entryPointVersion }) => {
        const anvilRpc = inject("anvilRpc")
        const altoRpc = inject("altoRpc")

        const anvilClient = createTestClient({
            chain: foundry,
            mode: "anvil",
            transport: http(anvilRpc)
        })

        beforeEach(async () => {
            await beforeEachCleanUp({ anvilRpc, altoRpc })
        })

        test("Return null if hash not found", async () => {
            const bundlerClient = getPimlicoClient({
                entryPointVersion,
                altoRpc
            })

            const hash =
                "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

            await expect(async () => {
                await bundlerClient.getUserOperation({
                    hash
                })
            }).rejects.toThrow(UserOperationNotFoundError)
        })

        test("Pending UserOperation should return null", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            await anvilClient.setAutomine(false)
            await anvilClient.mine({ blocks: 1 })

            const hash = await smartAccountClient.sendUserOperation({
                calls: [
                    {
                        to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                        data: "0x",
                        value: 0n
                    }
                ]
            })

            await new Promise((resolve) => setTimeout(resolve, 1500))

            await expect(async () => {
                await smartAccountClient.getUserOperationReceipt({
                    hash
                })
            }).rejects.toThrow(UserOperationReceiptNotFoundError)

            await anvilClient.setAutomine(true)
        })

        test("Return userOperation, entryPoint, blockNum, blockHash, txHash for mined tx", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const hash = await smartAccountClient.sendUserOperation({
                calls: [
                    {
                        to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                        data: "0x",
                        value: 0n
                    }
                ]
            })

            await new Promise((resolve) => setTimeout(resolve, 1500))

            const response = await smartAccountClient.getUserOperation({
                hash
            })

            expect(response).not.toBeNull()
            expect(response?.entryPoint).toBe(entryPoint)
            expect(response?.blockHash).not.toBeUndefined()
            expect(response?.transactionHash).not.toBeUndefined()
        })
    }
)
