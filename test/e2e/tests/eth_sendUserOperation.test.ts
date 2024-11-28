import { encodeNonce } from "permissionless/utils"
import {
    http,
    type Hex,
    createPublicClient,
    createTestClient,
    getContract,
    parseEther,
    parseGwei,
    Address,
    concat
} from "viem"
import {
    type EntryPointVersion,
    UserOperationReceiptNotFoundError,
    entryPoint06Address,
    entryPoint07Address,
    UserOperation,
    UserOperationSignatureError,
    UserOperationExecutionError
} from "viem/account-abstraction"
import { generatePrivateKey } from "viem/accounts"
import { foundry } from "viem/chains"
import { beforeEach, describe, expect, test } from "vitest"
import { ANVIL_RPC } from "../src/constants"
import {
    beforeEachCleanUp,
    getSmartAccountClient,
    sendBundleNow,
    setBundlingMode
} from "../src/utils"
import { ENTRYPOINT_V06_ABI, ENTRYPOINT_V07_ABI } from "./utils/abi"
import { getNonceKeyAndValue } from "./utils/userop"
import { deployPaymaster } from "../src/testPaymaster"

const anvilClient = createTestClient({
    chain: foundry,
    mode: "anvil",
    transport: http(ANVIL_RPC)
})

const publicClient = createPublicClient({
    transport: http(ANVIL_RPC),
    chain: foundry
})

describe.each([
    {
        entryPoint: entryPoint06Address,
        entryPointVersion: "0.6" as EntryPointVersion
    },
    {
        entryPoint: entryPoint07Address,
        entryPointVersion: "0.7" as EntryPointVersion
    }
])(
    "$entryPointVersion supports eth_sendUserOperation",
    ({ entryPoint, entryPointVersion }) => {
        const TO_ADDRESS = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
        const VALUE = parseEther("0.15")
        let paymaster: Address

        beforeEach(async () => {
            await beforeEachCleanUp()
            paymaster = await deployPaymaster(entryPoint)
        })

        test("Send UserOperation", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion
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
                entryPointVersion
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
                entryPointVersion
            })
            const secondClient = await getSmartAccountClient({
                entryPointVersion
            })

            await setBundlingMode("manual")

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

            await expect(async () => {
                await firstClient.getUserOperationReceipt({
                    hash: firstHash
                })
            }).rejects.toThrow(UserOperationReceiptNotFoundError)
            await expect(async () => {
                await secondClient.getUserOperationReceipt({
                    hash: secondHash
                })
            }).rejects.toThrow(UserOperationReceiptNotFoundError)

            await sendBundleNow()

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

            await setBundlingMode("manual")

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

            await sendBundleNow()

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

            await sendBundleNow()

            const receipts = await Promise.all(
                opHashes.map(async (hash) => {
                    const receipt = await client.waitForUserOperationReceipt({
                        hash
                    })

                    return receipt
                })
            )

            expect(receipts.every((receipt) => receipt.success)).toEqual(true)

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

            expect(bundleNonceKeys).toEqual(sortedNonceKeys)
        })

        test("Send queued UserOperations", async () => {
            // Doesn't work with v0.6 userops
            if (entryPointVersion === "0.6") {
                return
            }

            await setBundlingMode("manual")

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

            await sendBundleNow()

            const nonceKey = 100n
            const nonceValueDiffs = [0n, 1n, 2n]

            // Send 3 sequential user ops
            const sendUserOperation = async (nonceValueDiff: bigint) => {
                const nonce = (await entryPointContract.read.getNonce([
                    client.account.address,
                    nonceKey
                ])) as bigint

                return client.sendUserOperation({
                    calls: [
                        {
                            to: TO_ADDRESS,
                            value: VALUE,
                            data: "0x"
                        }
                    ],
                    nonce: nonce + nonceValueDiff
                })
            }
            const opHashes: Hex[] = []

            for (const nonceValueDiff of nonceValueDiffs) {
                opHashes.push(await sendUserOperation(nonceValueDiff))
            }

            await sendBundleNow()

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
                entryPointVersion
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
                entryPointVersion
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
                entryPointVersion
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

            if (entryPointVersion === "0.7") {
                op.paymaster = paymaster
                op.paymasterData = invalidPaymasterSignature // FAILING CONDITION
                op.paymasterVerificationGasLimit = 100_000n
            } else {
                op.paymasterAndData = concat([
                    paymaster,
                    invalidPaymasterSignature
                ])
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
    }
)
