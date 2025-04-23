import { encodeNonce, getRequiredPrefund } from "permissionless/utils"
import {
    http,
    type Hex,
    createPublicClient,
    createTestClient,
    getContract,
    parseEther,
    parseGwei,
    type Address,
    concat
} from "viem"
import {
    UserOperationReceiptNotFoundError,
    entryPoint06Address,
    entryPoint07Address,
    type UserOperation
} from "viem/account-abstraction"
import { generatePrivateKey } from "viem/accounts"
import { foundry } from "viem/chains"
import { beforeEach, describe, expect, inject, test } from "vitest"
import {
    beforeEachCleanUp,
    getSmartAccountClient,
    sendBundleNow,
    setBundlingMode
} from "../src/utils/index.js"
import { ENTRYPOINT_V06_ABI, ENTRYPOINT_V07_ABI } from "../src/utils/abi.js"
import { getNonceKeyAndValue } from "../src/utils/userop.js"
import { deployPaymaster } from "../src/testPaymaster.js"
import {
    type EntryPointVersion,
    entryPoint08Address,
    getViemEntryPointVersion
} from "../src/constants.js"

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
    "$entryPointVersion supports eth_sendUserOperation",
    ({ entryPoint, entryPointVersion }) => {
        const TO_ADDRESS = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
        const VALUE = parseEther("0.15")
        let paymaster: Address

        const anvilRpc = inject("anvilRpc")
        const altoRpc = inject("altoRpc")

        const anvilClient = createTestClient({
            chain: foundry,
            mode: "anvil",
            transport: http(anvilRpc)
        })

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

        test("Send UserOperation", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const hash = await client.sendUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })

            await new Promise((resolve) => setTimeout(resolve, 1500))

            await client.waitForUserOperationReceipt({ hash })

            expect(
                await publicClient.getBalance({ address: TO_ADDRESS })
            ).toBeGreaterThanOrEqual(VALUE)
        })

        test("Replace mempool transaction", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            await anvilClient.setAutomine(false)
            await anvilClient.mine({ blocks: 1 })

            const hash = await client.sendUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })

            await new Promise((resolve) => setTimeout(resolve, 1500))

            // increase next block base fee whilst current tx is in mempool
            await anvilClient.setNextBlockBaseFeePerGas({
                baseFeePerGas: parseGwei("150")
            })
            await new Promise((resolve) => setTimeout(resolve, 2500))

            // check that no tx was mined
            await expect(async () => {
                await client.getUserOperationReceipt({
                    hash
                })
            }).rejects.toThrow(UserOperationReceiptNotFoundError)

            // new block should trigger alto's mempool to replace the eoa tx with too low gasPrice
            await anvilClient.mine({ blocks: 1 })
            await new Promise((resolve) => setTimeout(resolve, 5000))
            await anvilClient.mine({ blocks: 1 })

            const opReceipt = await client.getUserOperationReceipt({
                hash
            })

            expect(opReceipt?.success).equal(true)
            expect(
                await publicClient.getBalance({ address: TO_ADDRESS })
            ).toBeGreaterThanOrEqual(VALUE)
        })

        test("Send multiple UserOperations", async () => {
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

            const firstHash = await firstClient.sendUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })
            const secondHash = await secondClient.sendUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })

            await expect(() =>
                firstClient.getUserOperationReceipt({
                    hash: firstHash
                })
            ).rejects.toThrow(UserOperationReceiptNotFoundError)
            await expect(() =>
                secondClient.getUserOperationReceipt({
                    hash: secondHash
                })
            ).rejects.toThrow(UserOperationReceiptNotFoundError)

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

        test("Send parallel UserOperations", async () => {
            const nonceKeys = [10n, 12n, 4n, 1n]

            await setBundlingMode({
                mode: "manual",
                altoRpc
            })

            const privateKey = generatePrivateKey()

            const entryPointContract = getContract({
                address: entryPoint,
                abi:
                    entryPointVersion === "0.6"
                        ? ENTRYPOINT_V06_ABI
                        : ENTRYPOINT_V07_ABI,
                client: {
                    public: publicClient
                }
            })

            // Needs to deploy user op first
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                privateKey
            })

            await client.sendUserOperation({
                calls: [
                    {
                        to: client.account.address,
                        value: parseEther("0.01"),
                        data: "0x"
                    }
                ]
            })

            await sendBundleNow({ altoRpc })

            const opHashes = await Promise.all(
                nonceKeys.map((nonceKey) =>
                    client.sendUserOperation({
                        calls: [
                            {
                                to: TO_ADDRESS,
                                value: VALUE,
                                data: "0x"
                            }
                        ],
                        nonce: encodeNonce({
                            key: nonceKey,
                            sequence: 0n
                        })
                    })
                )
            )

            await sendBundleNow({ altoRpc })

            const receipts = await Promise.all(
                opHashes.map(async (hash) => {
                    const receipt = await client.waitForUserOperationReceipt({
                        hash
                    })

                    return receipt
                })
            )

            expect(receipts.every((receipt) => receipt.success)).toEqual(true)

            expect(
                receipts.every(
                    (receipt) =>
                        receipt.receipt.transactionHash ===
                        receipts[0].receipt.transactionHash
                )
            ).toEqual(true)

            // user ops whould be ordered by the nonce key
            const logs = await entryPointContract.getEvents.UserOperationEvent()

            // @ts-ignore
            const bundleNonceKeys = logs.map(
                // @ts-ignore
                (log) => getNonceKeyAndValue(log.args.nonce)[0]
            )

            const sortedNonceKeys = [...nonceKeys].sort(
                (a, b) => Number(a) - Number(b)
            )

            expect(new Set(bundleNonceKeys)).toEqual(new Set(sortedNonceKeys))
        })

        test("Send queued UserOperations", async () => {
            // Doesn't work with v0.6 userops
            if (entryPointVersion === "0.6") {
                return
            }

            await setBundlingMode({
                mode: "manual",
                altoRpc
            })

            const entryPointContract = getContract({
                address: entryPoint,
                abi:
                    // @ts-ignore
                    entryPointVersion === "0.6"
                        ? ENTRYPOINT_V06_ABI
                        : ENTRYPOINT_V07_ABI,
                client: {
                    public: publicClient
                }
            })

            const privateKey = generatePrivateKey()

            // Needs to deploy user op first
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                privateKey
            })

            await client.sendUserOperation({
                calls: [
                    {
                        to: client.account.address,
                        value: parseEther("0.01"),
                        data: "0x"
                    }
                ]
            })

            await sendBundleNow({ altoRpc })

            const nonceKey = 100n
            const nonceValueDiffs = [0n, 1n, 2n]

            // Send 3 sequential user ops
            const sendUserOperation = (nonce: bigint) => {
                return client.sendUserOperation({
                    calls: [
                        {
                            to: TO_ADDRESS,
                            value: VALUE,
                            data: "0x"
                        }
                    ],
                    nonce: nonce
                })
            }
            const opHashes: Hex[] = []
            const nonce = (await entryPointContract.read.getNonce([
                client.account.address,
                nonceKey
            ])) as bigint

            for (const nonceValueDiff of nonceValueDiffs) {
                opHashes.push(await sendUserOperation(nonce + nonceValueDiff))
            }

            await sendBundleNow({ altoRpc })

            const receipts = await Promise.all(
                opHashes.map(async (hash) => {
                    const receipt = await client.waitForUserOperationReceipt({
                        hash
                    })

                    return receipt
                })
            )

            expect(receipts.every((receipt) => receipt.success)).toEqual(true)

            expect(
                receipts.every(
                    (receipt) =>
                        receipt.receipt.transactionHash ===
                        receipts[0].receipt.transactionHash
                )
            ).toEqual(true)
        })

        test("Should throw 'already known' if same userOperation is sent twice", async () => {
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
            op.signature = await client.account.signUserOperation(op)

            await client.sendUserOperation(op) // first should go through

            await expect(async () => {
                await client.sendUserOperation(op) // second should fail due to "already known"
            }).rejects.toThrowError(
                expect.objectContaining({
                    details: expect.stringContaining("Already known")
                })
            )
        })

        test("Should throw AA24 if signature is invalid", async () => {
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
                signatures: await client.account.getStubSignature() // FAILING CONDITION
            })) as UserOperation

            await expect(async () => {
                await client.sendUserOperation(op)
            }).rejects.toThrowError(
                expect.objectContaining({
                    name: "UserOperationExecutionError",
                    details: expect.stringMatching(
                        /(AA24|Invalid UserOperation signature or paymaster signature)/i
                    )
                })
            )
        })

        test("Should throw AA34 if paymaster signature is invalid", async () => {
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

            const invalidPaymasterSignature = "0xff"

            if (entryPointVersion === "0.6") {
                op.paymasterAndData = concat([
                    paymaster,
                    invalidPaymasterSignature
                ])
            } else {
                op.paymaster = paymaster
                op.paymasterData = invalidPaymasterSignature // FAILING CONDITION
                op.paymasterVerificationGasLimit = 100_000n
            }

            op.signature = await client.account.signUserOperation(op)

            await expect(async () => {
                await client.sendUserOperation(op)
            }).rejects.toThrowError(
                expect.objectContaining({
                    name: "UserOperationExecutionError",
                    details: expect.stringMatching(
                        /(AA34|Invalid UserOperation signature or paymaster signature)/i
                    )
                })
            )
        })

        test("Should reject userOperation with insufficient prefund", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const op = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: 0n,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            op.signature = await client.account.signUserOperation(op)

            const requiedPrefund = getRequiredPrefund({
                userOperation: op,
                entryPointVersion: getViemEntryPointVersion(entryPointVersion)
            })

            // Should throw when there is insufficient prefund
            await anvilClient.setBalance({
                address: client.account.address,
                value: requiedPrefund - 1n
            })

            await expect(async () => {
                await client.sendUserOperation(op)
            }).rejects.toThrowError(
                expect.objectContaining({
                    name: "UserOperationExecutionError",
                    details: expect.stringMatching(/(AA21|didn't pay prefund)/i)
                })
            )

            // Should be able to send userOperation when there is sufficient prefund
            await anvilClient.setBalance({
                address: client.account.address,
                value: requiedPrefund
            })

            const hash = await client.sendUserOperation(op)

            await new Promise((resolve) => setTimeout(resolve, 1500))

            const receipt = await client.waitForUserOperationReceipt({ hash })
            expect(receipt.success).toEqual(true)
        })
    }
)
