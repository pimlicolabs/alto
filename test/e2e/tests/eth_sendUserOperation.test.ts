import { test, describe, expect, beforeEach } from "vitest"
import {
    beforeEachCleanUp,
    getSmartAccountClient,
    sendBundleNow,
    setBundlingMode
} from "../src/utils"
import { foundry } from "viem/chains"
import {
    type Hex,
    createPublicClient,
    createTestClient,
    getContract,
    http,
    parseEther,
    parseGwei
} from "viem"
import { ANVIL_RPC } from "../src/constants"
import { ENTRYPOINT_V06_ABI, ENTRYPOINT_V07_ABI } from "./utils/abi"
import { getNonceKeyAndValue } from "./utils/userop"
import { generatePrivateKey } from "viem/accounts"
import {
    type EntryPointVersion,
    entryPoint06Address,
    entryPoint07Address,
    UserOperationReceiptNotFoundError
} from "viem/account-abstraction"
import { encodeNonce } from "permissionless/utils"

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
        beforeEach(async () => {
            await beforeEachCleanUp()
        })

        test("Send UserOperation", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion
            })

            const to = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
            const value = parseEther("0.15")

            const hash = await smartAccountClient.sendUserOperation({
                calls: [
                    {
                        to,
                        value,
                        data: "0x"
                    }
                ]
            })

            await new Promise((resolve) => setTimeout(resolve, 1500))

            await smartAccountClient.waitForUserOperationReceipt({ hash })

            expect(
                await publicClient.getBalance({ address: to })
            ).toBeGreaterThanOrEqual(value)
        })

        test("Replace mempool transaction", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion
            })

            await anvilClient.setAutomine(false)
            await anvilClient.mine({ blocks: 1 })

            const to = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
            const value = parseEther("0.15")

            const hash = await smartAccountClient.sendUserOperation({
                calls: [
                    {
                        to,
                        value,
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
                await smartAccountClient.getUserOperationReceipt({
                    hash
                })
            }).rejects.toThrow(UserOperationReceiptNotFoundError)

            // new block should trigger alto's mempool to replace the eoa tx with too low gasPrice
            await anvilClient.mine({ blocks: 1 })
            await new Promise((resolve) => setTimeout(resolve, 5000))
            await anvilClient.mine({ blocks: 1 })

            const opReceipt = await smartAccountClient.getUserOperationReceipt({
                hash
            })

            expect(opReceipt?.success).equal(true)
            expect(
                await publicClient.getBalance({ address: to })
            ).toBeGreaterThanOrEqual(value)
        })

        test("Send multiple UserOperations", async () => {
            const firstClient = await getSmartAccountClient({
                entryPointVersion
            })
            const secondClient = await getSmartAccountClient({
                entryPointVersion
            })

            const to = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
            const value = parseEther("0.15")

            await setBundlingMode("manual")

            const firstHash = await firstClient.sendUserOperation({
                calls: [
                    {
                        to,
                        value,
                        data: "0x"
                    }
                ]
            })
            const secondHash = await secondClient.sendUserOperation({
                calls: [
                    {
                        to,
                        value,
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
                await publicClient.getBalance({ address: to })
            ).toBeGreaterThanOrEqual(value * 2n)
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
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                privateKey
            })

            await smartAccountClient.sendUserOperation({
                calls: [
                    {
                        to: smartAccountClient.account.address,
                        value: parseEther("0.01"),
                        data: "0x"
                    }
                ]
            })

            await sendBundleNow()

            const opHashes = await Promise.all(
                nonceKeys.map((nonceKey) =>
                    smartAccountClient.sendUserOperation({
                        calls: [
                            {
                                to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                                value: parseEther("0.15"),
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
                    const receipt =
                        await smartAccountClient.waitForUserOperationReceipt({
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
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                privateKey
            })

            await smartAccountClient.sendUserOperation({
                calls: [
                    {
                        to: smartAccountClient.account.address,
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
                const to = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
                const value = parseEther("0.15")

                const nonce = (await entryPointContract.read.getNonce([
                    smartAccountClient.account.address,
                    nonceKey
                ])) as bigint

                return smartAccountClient.sendUserOperation({
                    calls: [
                        {
                            to,
                            value,
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
                    const receipt =
                        await smartAccountClient.waitForUserOperationReceipt({
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
    }
)
