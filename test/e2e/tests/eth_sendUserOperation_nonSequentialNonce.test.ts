import { encodeNonce } from "permissionless/utils"
import {
    http,
    type Hex,
    createPublicClient,
    createTestClient,
    getContract,
    parseEther
} from "viem"
import {
    type EntryPointVersion,
    type UserOperation,
    entryPoint06Address,
    entryPoint07Address,
    entryPoint08Address
} from "viem/account-abstraction"
import { generatePrivateKey } from "viem/accounts"
import { foundry } from "viem/chains"
import { beforeEach, describe, expect, inject, test } from "vitest"
import { getEntryPointAbi } from "../src/utils/entrypoint.js"
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
    "$entryPointVersion non-sequential nonce handling",
    ({ entryPoint, entryPointVersion }) => {
        const TO_ADDRESS = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
        const VALUE = parseEther("0.01")

        const anvilRpc = inject("anvilRpc")
        const altoRpc = inject("altoRpc")

        const publicClient = createPublicClient({
            transport: http(anvilRpc),
            chain: foundry
        })

        beforeEach(async () => {
            await beforeEachCleanUp({ anvilRpc, altoRpc })
        })

        test("Should mine both userOps when sending nonce+1 then nonce", async () => {
            // This test only applies to v0.7 and v0.8
            if (entryPointVersion === "0.6") {
                return
            }

            await setBundlingMode({
                mode: "manual",
                altoRpc
            })

            const privateKey = generatePrivateKey()

            const entryPointContract = getContract({
                address: entryPoint,
                abi: getEntryPointAbi(entryPointVersion),
                client: {
                    public: publicClient
                }
            })

            // Create client
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                privateKey
            })

            // Deploy the account first
            await client.sendUserOperation({
                calls: [
                    {
                        to: client.account.address,
                        value: parseEther("1"),
                        data: "0x"
                    }
                ]
            })

            await sendBundleNow({ altoRpc })

            // Get current nonce for key 0
            const currentNonce = (await entryPointContract.read.getNonce([
                client.account.address,
                0n // nonce key
            ])) as bigint

            // Prepare userOp with current nonce
            const userOpCurrentNonce = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ],
                nonce: currentNonce
            })) as UserOperation

            // Create userOp with nonce + 1 by reusing the prepared operation
            const userOpNextNonce = {
                ...userOpCurrentNonce,
                nonce: currentNonce + 1n
            } as UserOperation

            // Sign both userOps
            userOpCurrentNonce.signature =
                await client.account.signUserOperation(userOpCurrentNonce)
            userOpNextNonce.signature =
                await client.account.signUserOperation(userOpNextNonce)

            // Send userOp with nonce+1 first
            const hashNext = await client.sendUserOperation(userOpNextNonce)

            // Wait a bit to ensure it's in the mempool
            await new Promise((resolve) => setTimeout(resolve, 500))

            // Send userOp with current nonce
            const hashCurrent =
                await client.sendUserOperation(userOpCurrentNonce)

            // Call bundle submission
            await sendBundleNow({ altoRpc })

            // Both userOps should be mined
            const receiptCurrent = await client.waitForUserOperationReceipt({
                hash: hashCurrent
            })
            const receiptNext = await client.waitForUserOperationReceipt({
                hash: hashNext
            })

            // Verify both were successful
            expect(receiptCurrent.success).toEqual(true)
            expect(receiptNext.success).toEqual(true)

            // Verify they were included in the same bundle (same transaction)
            expect(receiptCurrent.receipt.transactionHash).toEqual(
                receiptNext.receipt.transactionHash
            )

            // Verify the target address received both payments
            const finalBalance = await publicClient.getBalance({
                address: TO_ADDRESS
            })
            expect(finalBalance).toBeGreaterThanOrEqual(VALUE * 3n)
        })

        test("Should mine 5 userOps when sent in random order", async () => {
            // This test only applies to v0.7 and v0.8
            if (entryPointVersion === "0.6") {
                return
            }

            await setBundlingMode({
                mode: "manual",
                altoRpc
            })

            const privateKey = generatePrivateKey()

            const entryPointContract = getContract({
                address: entryPoint,
                abi: getEntryPointAbi(entryPointVersion),
                client: {
                    public: publicClient
                }
            })

            // Create client
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                privateKey
            })

            // Deploy the account first
            await client.sendUserOperation({
                calls: [
                    {
                        to: client.account.address,
                        value: parseEther("1"),
                        data: "0x"
                    }
                ]
            })

            await sendBundleNow({ altoRpc })

            // Get current nonce for key 0
            const currentNonce = (await entryPointContract.read.getNonce([
                client.account.address,
                0n // nonce key
            ])) as bigint

            // Prepare base userOp once
            const baseOp = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Create 5 userOps with sequential nonces
            const userOps: Array<{
                op: UserOperation
                nonce: bigint
                hash?: Hex
            }> = []
            for (let i = 0; i < 5; i++) {
                const op = {
                    ...baseOp,
                    nonce: currentNonce + BigInt(i)
                } as UserOperation
                op.signature = await client.account.signUserOperation(op)
                userOps.push({ op, nonce: currentNonce + BigInt(i) })
            }

            // Shuffle the array to send in random order
            const shuffled = [...userOps].sort(() => Math.random() - 0.5)

            // Send all userOps in random order
            for (const userOp of shuffled) {
                userOp.hash = await client.sendUserOperation(userOp.op)
                // Small delay to ensure they're processed in order sent
                await new Promise((resolve) => setTimeout(resolve, 100))
            }

            // Trigger bundle submission
            await sendBundleNow({ altoRpc })

            // All 5 userOps should be mined
            const receipts = await Promise.all(
                userOps.map(({ hash }) =>
                    client.waitForUserOperationReceipt({ hash: hash! })
                )
            )

            // Verify all were successful
            expect(receipts.every((r) => r.success)).toEqual(true)

            // Verify they were all in the same bundle (same transaction)
            const txHash = receipts[0].receipt.transactionHash
            expect(
                receipts.every((r) => r.receipt.transactionHash === txHash)
            ).toEqual(true)

            // Verify the target address received all 5 payments
            const finalBalance = await publicClient.getBalance({
                address: TO_ADDRESS
            })
            expect(finalBalance).toBeGreaterThanOrEqual(VALUE * 5n)
        })

        test("Should handle multiple non-sequential nonces across different keys", async () => {
            // This test only applies to v0.7 and v0.8
            if (entryPointVersion === "0.6") {
                return
            }

            await setBundlingMode({
                mode: "manual",
                altoRpc
            })

            const privateKey = generatePrivateKey()

            const entryPointContract = getContract({
                address: entryPoint,
                abi: getEntryPointAbi(entryPointVersion),
                client: {
                    public: publicClient
                }
            })

            // Create client
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                privateKey
            })

            // Deploy the account first
            await client.sendUserOperation({
                calls: [
                    {
                        to: client.account.address,
                        value: parseEther("1"),
                        data: "0x"
                    }
                ]
            })

            await sendBundleNow({ altoRpc })

            // Test with two different nonce keys
            const key1 = 10n
            const key2 = 20n

            // Get current nonces for both keys (should be 0)
            const currentNonceKey1 = (await entryPointContract.read.getNonce([
                client.account.address,
                key1
            ])) as bigint

            const currentNonceKey2 = (await entryPointContract.read.getNonce([
                client.account.address,
                key2
            ])) as bigint

            // Create nonces for each key
            const nonceKey1Current = encodeNonce({
                key: key1,
                sequence: currentNonceKey1
            })
            const nonceKey1Next = encodeNonce({
                key: key1,
                sequence: currentNonceKey1 + 1n
            })
            const nonceKey2Current = encodeNonce({
                key: key2,
                sequence: currentNonceKey2
            })
            const nonceKey2Next = encodeNonce({
                key: key2,
                sequence: currentNonceKey2 + 1n
            })

            // Prepare base userOp once
            const baseOp = (await client.prepareUserOperation({
                calls: [{ to: TO_ADDRESS, value: VALUE, data: "0x" }]
            })) as UserOperation

            // Create all userOps by reusing the base operation
            const ops: Array<{ op: UserOperation; hash?: Hex }> = []

            // Key1: sequence+1
            const op1 = {
                ...baseOp,
                nonce: nonceKey1Next
            } as UserOperation
            op1.signature = await client.account.signUserOperation(op1)
            ops.push({ op: op1 })

            // Key2: sequence+1
            const op2 = {
                ...baseOp,
                nonce: nonceKey2Next
            } as UserOperation
            op2.signature = await client.account.signUserOperation(op2)
            ops.push({ op: op2 })

            // Key1: current sequence
            const op3 = {
                ...baseOp,
                nonce: nonceKey1Current
            } as UserOperation
            op3.signature = await client.account.signUserOperation(op3)
            ops.push({ op: op3 })

            // Key2: current sequence
            const op4 = {
                ...baseOp,
                nonce: nonceKey2Current
            } as UserOperation
            op4.signature = await client.account.signUserOperation(op4)
            ops.push({ op: op4 })

            // Send all ops in the specified order
            for (let i = 0; i < ops.length; i++) {
                ops[i].hash = await client.sendUserOperation(ops[i].op)
                await new Promise((resolve) => setTimeout(resolve, 200))
            }

            // Trigger bundle submission
            await sendBundleNow({ altoRpc })

            // All userOps should be mined
            const receipts = await Promise.all(
                ops.map(({ hash }) =>
                    client.waitForUserOperationReceipt({ hash: hash! })
                )
            )

            // Verify all were successful
            expect(receipts.every((r) => r.success)).toEqual(true)

            // Verify they were all in the same bundle
            const txHash = receipts[0].receipt.transactionHash
            expect(
                receipts.every((r) => r.receipt.transactionHash === txHash)
            ).toEqual(true)

            // Verify the target address received all payments
            const finalBalance = await publicClient.getBalance({
                address: TO_ADDRESS
            })
            expect(finalBalance).toBeGreaterThanOrEqual(VALUE * 4n)
        })
    }
)
