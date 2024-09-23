import { describe, test, beforeAll, expect, beforeEach } from "vitest"
import {
    beforeEachCleanUp,
    getPimlicoClient,
    getSmartAccountClient,
    sendBundleNow,
    setBundlingMode
} from "../src/utils"
import {
    createPublicClient,
    createTestClient,
    getAddress,
    getContract,
    http,
    parseEther,
    parseGwei,
    zeroAddress
} from "viem"
import { ANVIL_RPC } from "../src/constants"
import { foundry } from "viem/chains"
import type { PimlicoClient } from "permissionless/clients/pimlico"
import {
    UserOperationReceiptNotFoundError,
    type UserOperation
} from "viem/account-abstraction"

const publicClient = createPublicClient({
    transport: http(ANVIL_RPC),
    chain: foundry
})

const anvilClient = createTestClient({
    chain: foundry,
    mode: "anvil",
    transport: http(ANVIL_RPC)
})

const SIMPLE_INFLATOR_CONTRACT = getContract({
    address: "0x92d2f9ef7b520d91a34501fbb31e5428ab2fd5df",
    abi: [
        {
            type: "function",
            name: "compress",
            inputs: [
                {
                    name: "op",
                    type: "tuple",
                    components: [
                        { name: "sender", type: "address" },
                        { name: "nonce", type: "uint256" },
                        { name: "initCode", type: "bytes" },
                        { name: "callData", type: "bytes" },
                        { name: "callGasLimit", type: "uint256" },
                        { name: "verificationGasLimit", type: "uint256" },
                        { name: "preVerificationGas", type: "uint256" },
                        { name: "maxFeePerGas", type: "uint256" },
                        { name: "maxPriorityFeePerGas", type: "uint256" },
                        { name: "paymasterAndData", type: "bytes" },
                        { name: "signature", type: "bytes" }
                    ]
                }
            ],
            outputs: [
                {
                    name: "compressed",
                    type: "bytes"
                }
            ],
            stateMutability: "pure"
        }
    ] as const,
    client: publicClient
})

describe("V0.6 pimlico_sendCompressedUserOperation", () => {
    let pimlicoBundlerClient: PimlicoClient

    beforeAll(() => {
        pimlicoBundlerClient = getPimlicoClient({
            entryPointVersion: "0.6"
        })
    })

    beforeEach(async () => {
        await beforeEachCleanUp()
    })

    test("Send compressed UserOperation", async () => {
        const smartAccountClient = await getSmartAccountClient({
            entryPointVersion: "0.6"
        })

        const to = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
        const value = parseEther("0.15")

        const op = (await smartAccountClient.prepareUserOperation({
            calls: [
                {
                    to,
                    value,
                    data: "0x"
                }
            ]
        })) as UserOperation<"0.6">
        op.signature = await smartAccountClient.account.signUserOperation(op)

        const compressedUserOperation =
            // @ts-ignore: we know that op is properly typed
            await SIMPLE_INFLATOR_CONTRACT.read.compress([op])

        const hash = await pimlicoBundlerClient.sendCompressedUserOperation({
            compressedUserOperation,
            inflatorAddress: SIMPLE_INFLATOR_CONTRACT.address
        })

        await new Promise((resolve) => setTimeout(resolve, 1500))

        const receipt = await pimlicoBundlerClient.waitForUserOperationReceipt({
            hash
        })

        const txReceipt = await publicClient.getTransaction({
            hash: receipt.receipt.transactionHash
        })

        expect(getAddress(txReceipt.to || zeroAddress)).toEqual(
            "0x09aeBCF1DF7d4D0FBf26073e79A6B250f458fFB8"
        )

        expect(
            await publicClient.getBalance({ address: to })
        ).toBeGreaterThanOrEqual(value)
    })

    test("Replace mempool transaction", async () => {
        const smartAccountClient = await getSmartAccountClient({
            entryPointVersion: "0.6"
        })
        const smartAccount = smartAccountClient.account

        await anvilClient.setAutomine(false)
        await anvilClient.mine({ blocks: 1 })

        const to = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
        const value = parseEther("0.15")

        const op = (await smartAccountClient.prepareUserOperation({
            calls: [
                {
                    to,
                    value,
                    data: "0x"
                }
            ]
        })) as UserOperation<"0.6">
        op.signature = await smartAccount.signUserOperation(op)

        const compressedUserOperation =
            // @ts-ignore: we know that op is properly typed
            await SIMPLE_INFLATOR_CONTRACT.read.compress([op])

        const hash = await pimlicoBundlerClient.sendCompressedUserOperation({
            compressedUserOperation,
            inflatorAddress: SIMPLE_INFLATOR_CONTRACT.address
        })

        await new Promise((resolve) => setTimeout(resolve, 1500))

        // increase next block base fee whilst current tx is in mempool
        await anvilClient.setNextBlockBaseFeePerGas({
            baseFeePerGas: parseGwei("150")
        })
        await anvilClient.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, 1500))

        // check that no tx was mined
        await expect(async () => {
            await pimlicoBundlerClient.getUserOperationReceipt({
                hash
            })
        }).rejects.toThrow(UserOperationReceiptNotFoundError)

        // new block should trigger alto's mempool to replace the eoa tx with too low gasPrice
        await anvilClient.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, 1500))

        const opReceipt = await pimlicoBundlerClient.getUserOperationReceipt({
            hash
        })

        expect(opReceipt?.success).equal(true)
        expect(
            await publicClient.getBalance({ address: to })
        ).toBeGreaterThanOrEqual(value)

        const txReceipt = await publicClient.getTransaction({
            // @ts-ignore: null check done above but ts doesnt recognize it
            hash: opReceipt.receipt.transactionHash
        })
        expect(getAddress(txReceipt.to || zeroAddress)).toEqual(
            "0x09aeBCF1DF7d4D0FBf26073e79A6B250f458fFB8"
        )
    })

    test("Send multiple compressedOps", async () => {
        const firstClient = await getSmartAccountClient({
            entryPointVersion: "0.6"
        })
        const secondClient = await getSmartAccountClient({
            entryPointVersion: "0.6"
        })

        const to = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
        const value = parseEther("0.15")

        // create sender op
        const firstOp = (await firstClient.prepareUserOperation({
            calls: [
                {
                    to: "0x0000000000000000000000000000000000000000",
                    value: value,
                    data: "0x"
                }
            ]
        })) as UserOperation<"0.6">

        firstOp.signature = await firstClient.account.signUserOperation(firstOp)

        // create relayer op
        const secondOp = (await secondClient.prepareUserOperation({
            calls: [
                {
                    to,
                    value,
                    data: "0x"
                }
            ]
        })) as UserOperation<"0.6">

        secondOp.signature =
            await secondClient.account.signUserOperation(secondOp)

        await setBundlingMode("manual")

        const firstCompressedOp = await SIMPLE_INFLATOR_CONTRACT.read.compress([
            // @ts-ignore: we know that firstOp is properly typed
            firstOp
        ])
        const firstHash =
            await pimlicoBundlerClient.sendCompressedUserOperation({
                compressedUserOperation: firstCompressedOp,
                inflatorAddress: SIMPLE_INFLATOR_CONTRACT.address
            })
        const secondCompressedOp = await SIMPLE_INFLATOR_CONTRACT.read.compress(
            // @ts-ignore: we know that firstOp is properly typed
            [secondOp]
        )
        const secondHash =
            await pimlicoBundlerClient.sendCompressedUserOperation({
                compressedUserOperation: secondCompressedOp,
                inflatorAddress: SIMPLE_INFLATOR_CONTRACT.address
            })

        await expect(async () => {
            await pimlicoBundlerClient.getUserOperationReceipt({
                hash: firstHash
            })
        }).rejects.toThrow(UserOperationReceiptNotFoundError)
        await expect(async () => {
            await pimlicoBundlerClient.getUserOperationReceipt({
                hash: secondHash
            })
        }).rejects.toThrow(UserOperationReceiptNotFoundError)

        await sendBundleNow()

        const firstReceipt =
            await pimlicoBundlerClient.waitForUserOperationReceipt({
                hash: firstHash
            })

        const secondReceipt =
            await pimlicoBundlerClient.waitForUserOperationReceipt({
                hash: secondHash
            })

        expect(firstReceipt.success).toEqual(true)
        expect(secondReceipt.success).toEqual(true)

        const firstTx = await publicClient.getTransaction({
            hash: firstReceipt.receipt.transactionHash
        })
        const secondTx = await publicClient.getTransaction({
            hash: firstReceipt.receipt.transactionHash
        })

        expect(getAddress(firstTx.to || zeroAddress)).toEqual(
            "0x09aeBCF1DF7d4D0FBf26073e79A6B250f458fFB8"
        )

        expect(getAddress(secondTx.to || zeroAddress)).toEqual(
            "0x09aeBCF1DF7d4D0FBf26073e79A6B250f458fFB8"
        )

        expect(
            await publicClient.getBalance({ address: to })
        ).toBeGreaterThanOrEqual(value * 2n)
    })
})
