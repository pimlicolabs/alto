import { deepHexlify } from "permissionless"
import {
    http,
    type Address,
    type Hex,
    createPublicClient,
    parseEther,
    parseGwei
} from "viem"
import {
    type EntryPointVersion,
    type UserOperation,
    entryPoint06Address,
    entryPoint07Address,
    entryPoint08Address
} from "viem/account-abstraction"
import { foundry } from "viem/chains"
import { beforeEach, describe, expect, inject, test } from "vitest"
import { deployPaymaster } from "../src/testPaymaster.js"
import {
    beforeEachCleanUp,
    getSmartAccountClient,
    sendBundleNow,
    setBundlingMode
} from "../src/utils/index.js"

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
    "$entryPointVersion supports boost_sendUserOperation",
    ({ entryPoint, entryPointVersion }) => {
        const TO_ADDRESS = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
        const VALUE = parseEther("0.15")
        let paymaster: Address

        const anvilRpc = inject("anvilRpc")
        const altoRpc = inject("altoRpc")

        const publicClient = createPublicClient({
            transport: http(anvilRpc),
            chain: foundry
        })

        beforeEach(async () => {
            await beforeEachCleanUp({ anvilRpc, altoRpc })
            paymaster = await deployPaymaster({
                entryPoint,
                anvilRpc
            })
        })

        test("Send boosted UserOperation", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            // Prepare a boosted user operation with zero gas fees
            const op = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Set gas fees to zero for boosted operation
            op.maxFeePerGas = 0n
            op.maxPriorityFeePerGas = 0n
            op.signature = await client.account.signUserOperation(op)

            // Send the boosted user operation
            const hash = (await client.request({
                // @ts-ignore
                method: "boost_sendUserOperation",
                // @ts-ignore
                params: [deepHexlify(op), entryPoint]
            })) as Hex

            await new Promise((resolve) => setTimeout(resolve, 1500))

            const receipt = await client.waitForUserOperationReceipt({ hash })
            expect(receipt.success).toEqual(true)

            expect(
                await publicClient.getBalance({ address: TO_ADDRESS })
            ).toBeGreaterThanOrEqual(VALUE)
        })

        test("Should throw error if gas fees are not zero", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const op = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Keep non-zero gas fees (this should fail)
            op.signature = await client.account.signUserOperation(op)

            await expect(
                client.request({
                    // @ts-ignore
                    method: "boost_sendUserOperation",
                    // @ts-ignore
                    params: [deepHexlify(op), entryPoint]
                })
            ).rejects.toThrow(
                "maxFeePerGas and maxPriorityFeePerGas must be 0 for a boosted user operation"
            )
        })

        test("Should throw error if only maxFeePerGas is zero", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const op = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Set only maxFeePerGas to zero
            op.maxFeePerGas = 0n
            op.maxPriorityFeePerGas = parseGwei("1")
            op.signature = await client.account.signUserOperation(op)

            await expect(
                client.request({
                    // @ts-ignore
                    method: "boost_sendUserOperation",
                    // @ts-ignore
                    params: [deepHexlify(op), entryPoint]
                })
            ).rejects.toThrow(
                "maxFeePerGas and maxPriorityFeePerGas must be 0 for a boosted user operation"
            )
        })

        test("Should throw error if only maxPriorityFeePerGas is zero", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const op = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Set only maxPriorityFeePerGas to zero
            op.maxFeePerGas = parseGwei("1")
            op.maxPriorityFeePerGas = 0n
            op.signature = await client.account.signUserOperation(op)

            await expect(
                client.request({
                    // @ts-ignore
                    method: "boost_sendUserOperation",
                    // @ts-ignore
                    params: [deepHexlify(op), entryPoint]
                })
            ).rejects.toThrow(
                "maxFeePerGas and maxPriorityFeePerGas must be 0 for a boosted user operation"
            )
        })

        test("Send multiple boosted UserOperations", async () => {
            const firstClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })
            const secondClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            await setBundlingMode({
                mode: "manual",
                altoRpc
            })

            // Prepare first boosted operation
            const firstOp = (await firstClient.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            firstOp.maxFeePerGas = 0n
            firstOp.maxPriorityFeePerGas = 0n
            firstOp.signature =
                await firstClient.account.signUserOperation(firstOp)

            // Prepare second boosted operation
            const secondOp = (await secondClient.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            secondOp.maxFeePerGas = 0n
            secondOp.maxPriorityFeePerGas = 0n
            secondOp.signature =
                await secondClient.account.signUserOperation(secondOp)

            // Send both boosted operations
            const firstHash = (await firstClient.request({
                // @ts-ignore
                method: "boost_sendUserOperation",
                // @ts-ignore
                params: [deepHexlify(firstOp), entryPoint]
            })) as Hex

            const secondHash = (await secondClient.request({
                // @ts-ignore
                method: "boost_sendUserOperation",
                // @ts-ignore
                params: [deepHexlify(secondOp), entryPoint]
            })) as Hex

            await sendBundleNow({ altoRpc })

            expect(
                (
                    await firstClient.waitForUserOperationReceipt({
                        hash: firstHash
                    })
                ).success
            ).toEqual(true)
            expect(
                (
                    await secondClient.waitForUserOperationReceipt({
                        hash: secondHash
                    })
                ).success
            ).toEqual(true)

            expect(
                await publicClient.getBalance({ address: TO_ADDRESS })
            ).toBeGreaterThanOrEqual(VALUE * 2n)
        })

        test("Should reject boosted userOperation with invalid signature", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const op = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ],
                signature: await client.account.getStubSignature() // FAILING CONDITION
            })) as UserOperation

            // Set gas fees to zero for boosted operation
            op.maxFeePerGas = 0n
            op.maxPriorityFeePerGas = 0n

            await expect(
                client.request({
                    // @ts-ignore
                    method: "boost_sendUserOperation",
                    // @ts-ignore
                    params: [deepHexlify(op), entryPoint]
                })
            ).rejects.toThrow(
                /(AA24|Invalid UserOperation signature or paymaster signature)/i
            )
        })

        test("Should reject boosted userOperation with paymaster", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const op = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Set gas fees to zero for boosted operation
            op.maxFeePerGas = 0n
            op.maxPriorityFeePerGas = 0n

            // Add paymaster (this should fail for boosted operations)
            if (entryPointVersion === "0.6") {
                op.paymasterAndData = paymaster
            } else {
                op.paymaster = paymaster
                op.paymasterData = "0x"
                op.paymasterVerificationGasLimit = 100_000n
                op.paymasterPostOpGasLimit = 0n
            }

            op.signature = await client.account.signUserOperation(op)

            await expect(
                client.request({
                    // @ts-ignore
                    method: "boost_sendUserOperation",
                    // @ts-ignore
                    params: [deepHexlify(op), entryPoint]
                })
            ).rejects.toThrow(
                "Paymaster is not supported for boosted user operations"
            )
        })

        test("Should reject duplicate boosted userOperation", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const op = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Set gas fees to zero for boosted operation
            op.maxFeePerGas = 0n
            op.maxPriorityFeePerGas = 0n
            op.signature = await client.account.signUserOperation(op)

            // Send first boosted operation
            const firstHash = (await client.request({
                // @ts-ignore
                method: "boost_sendUserOperation",
                // @ts-ignore
                params: [deepHexlify(op), entryPoint]
            })) as Hex

            expect(firstHash).toBeDefined()

            // Try to send duplicate
            await expect(
                client.request({
                    // @ts-ignore
                    method: "boost_sendUserOperation",
                    // @ts-ignore
                    params: [deepHexlify(op), entryPoint]
                })
            ).rejects.toThrow("Already known")
        })
    }
)
