import { deepHexlify } from "permissionless"
import {
    type Address,
    type Hex,
    concat,
    decodeEventLog,
    encodeFunctionData,
    parseGwei
} from "viem"
import {
    type EntryPointVersion,
    type UserOperation,
    entryPoint06Address,
    entryPoint07Abi,
    entryPoint07Address,
    entryPoint08Address,
    getUserOperationHash,
    toPackedUserOperation
} from "viem/account-abstraction"
import { foundry } from "viem/chains"
import { beforeAll, beforeEach, describe, expect, inject, test } from "vitest"
import {
    deployEventHelper,
    eventHelperAbi,
    getEmitMessageCall,
    getEmitMultipleDataCall
} from "../src/eventHelper.js"
import {
    decodeRevert,
    deployRevertingContract,
    getRevertCall
} from "../src/revertingContract.js"
import { deployPaymaster } from "../src/testPaymaster.js"
import {
    beforeEachCleanUp,
    getPublicClient,
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
    "$entryPointVersion supports eth_getUserOperationReceipt",
    ({ entryPoint, entryPointVersion }) => {
        let revertingContract: Address
        let paymaster: Address
        let eventHelper: Address

        const anvilRpc = inject("anvilRpc")
        const altoRpc = inject("altoRpc")

        beforeAll(async () => {
            revertingContract = await deployRevertingContract({
                anvilRpc
            })
            paymaster = await deployPaymaster({
                entryPoint,
                anvilRpc
            })
            eventHelper = await deployEventHelper({
                anvilRpc
            })
        })

        beforeEach(async () => {
            await beforeEachCleanUp({ anvilRpc, altoRpc })
        })

        // uses pimlico_sendUserOperationNow to force send a reverting op (because it skips validation)
        test("Returns revert bytes when UserOperation reverts", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const { factory, factoryData } =
                await smartAccountClient.account.getFactoryArgs()

            let op: UserOperation
            if (entryPointVersion === "0.6") {
                op = {
                    callData: await smartAccountClient.account.encodeCalls([
                        {
                            to: revertingContract,
                            data: getRevertCall("foobar"),
                            value: 0n
                        }
                    ]),
                    initCode: concat([factory as Hex, factoryData as Hex]),
                    paymasterAndData: paymaster,
                    callGasLimit: 500_000n,
                    verificationGasLimit: 500_000n,
                    preVerificationGas: 500_000n,
                    sender: smartAccountClient.account.address,
                    nonce: 0n,
                    maxFeePerGas: parseGwei("10"),
                    maxPriorityFeePerGas: parseGwei("10")
                } as UserOperation<"0.6">
            } else {
                op = {
                    sender: smartAccountClient.account.address,
                    nonce: 0n,
                    factory,
                    factoryData,
                    callData: await smartAccountClient.account.encodeCalls([
                        {
                            to: revertingContract,
                            data: getRevertCall("foobar"),
                            value: 0n
                        }
                    ]),
                    callGasLimit: 500_000n,
                    verificationGasLimit: 500_000n,
                    preVerificationGas: 500_000n,
                    maxFeePerGas: parseGwei("10"),
                    maxPriorityFeePerGas: parseGwei("10"),
                    paymaster,
                    paymasterVerificationGasLimit: 100_000n,
                    paymasterPostOpGasLimit: 50_000n
                } as UserOperation<"0.7">
            }

            op.signature =
                await smartAccountClient.account.signUserOperation(op)

            await smartAccountClient.request({
                // @ts-ignore
                method: "pimlico_sendUserOperationNow",
                params: [deepHexlify(op), entryPoint]
            })

            await new Promise((resolve) => setTimeout(resolve, 1500))

            let hash: Hex
            if (entryPointVersion === "0.8") {
                const publicClient = getPublicClient(anvilRpc)

                const res = await publicClient.call({
                    to: entryPoint,
                    data: encodeFunctionData({
                        abi: entryPoint07Abi,
                        functionName: "getUserOpHash",
                        args: [toPackedUserOperation(op)]
                    })
                })

                hash = res.data as Hex
            } else {
                hash = getUserOperationHash({
                    userOperation: op,
                    chainId: foundry.id,
                    entryPointAddress: entryPoint,
                    entryPointVersion
                })
            }

            const receipt = await smartAccountClient.getUserOperationReceipt({
                hash
            })

            expect(receipt).not.toBeNull()
            expect(receipt?.success).toEqual(false)
            expect(decodeRevert(receipt?.reason as Hex)).toEqual("foobar")
        })

        test("Returns paymaster when one is used", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            let hash: Hex
            if (entryPointVersion === "0.6") {
                hash = await smartAccountClient.sendUserOperation({
                    calls: [
                        {
                            to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                            data: "0x",
                            value: 0n
                        }
                    ],
                    paymasterAndData: paymaster
                })
            } else {
                hash = await smartAccountClient.sendUserOperation({
                    calls: [
                        {
                            to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                            data: "0x",
                            value: 0n
                        }
                    ],
                    paymaster: paymaster,
                    paymasterVerificationGasLimit: 1_500_000n,
                    paymasterPostOpGasLimit: 500_000n
                })
            }

            await new Promise((resolve) => setTimeout(resolve, 1500))

            const receipt = await smartAccountClient.getUserOperationReceipt({
                hash
            })

            expect(receipt).not.toBeNull()
            expect(receipt?.success).toEqual(true)
            expect(receipt?.reason).toBeUndefined()
            expect(receipt?.paymaster).toEqual(paymaster)
        })

        // https://github.com/eth-infinitism/bundler/blob/3706bc/packages/bundler/test/UserOpMethodHandler.test.ts#L369-L372
        test("receipt should contain only userOp execution events", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const testMessage = "Hello from user operation!"
            const testValue = 123n

            const hash = await smartAccountClient.sendUserOperation({
                calls: [
                    {
                        to: eventHelper,
                        data: getEmitMessageCall(testMessage),
                        value: 0n
                    },
                    {
                        to: eventHelper,
                        data: getEmitMultipleDataCall(
                            "Test message",
                            testValue
                        ),
                        value: 0n
                    }
                ]
            })

            await new Promise((resolve) => setTimeout(resolve, 1500))

            const receipt = await smartAccountClient.getUserOperationReceipt({
                hash
            })

            // There should only be two events emitted.
            expect(receipt.logs).length(2)

            // Decode the first event (MessageEmitted)
            const decodedEvent1 = decodeEventLog({
                abi: eventHelperAbi,
                data: receipt.logs[0].data,
                topics: receipt.logs[0].topics
            })
            expect(decodedEvent1).toMatchObject({
                eventName: "MessageEmitted",
                args: { message: testMessage }
            })

            // Decode the second event (MessageWithSenderEmitted)
            const decodedEvent2 = decodeEventLog({
                abi: eventHelperAbi,
                data: receipt.logs[1].data,
                topics: receipt.logs[1].topics
            })
            expect(decodedEvent2).toMatchObject({
                eventName: "MessageWithSenderEmitted",
                args: {
                    message: "Test message",
                    value: testValue,
                    sender: smartAccountClient.account.address
                }
            })
        })

        test("Returns empty logs field when UserOperation emits no events", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            // Send operation with no calldata (no events will be emitted)
            const hash = await smartAccountClient.sendUserOperation({
                calls: [
                    {
                        to: smartAccountClient.account.address,
                        data: "0x",
                        value: 0n
                    }
                ]
            })

            await new Promise((resolve) => setTimeout(resolve, 1500))

            const receipt = await smartAccountClient.getUserOperationReceipt({
                hash
            })

            expect(receipt).not.toBeNull()
            expect(receipt?.success).toEqual(true)
            expect(receipt?.logs).toEqual([])
        })

        test("Returns only logs for specific UserOperation (not other ops in bundle)", async () => {
            await setBundlingMode({ mode: "manual", altoRpc })

            // Create two clients and send operations
            const [client1, client2] = await Promise.all([
                getSmartAccountClient({ entryPointVersion, anvilRpc, altoRpc }),
                getSmartAccountClient({ entryPointVersion, anvilRpc, altoRpc })
            ])

            const [hash1, hash2] = await Promise.all([
                client1.sendUserOperation({
                    calls: [
                        {
                            to: eventHelper,
                            data: getEmitMessageCall("Op1"),
                            value: 0n
                        }
                    ]
                }),
                client2.sendUserOperation({
                    calls: [
                        {
                            to: eventHelper,
                            data: getEmitMessageCall("Op2"),
                            value: 0n
                        }
                    ]
                })
            ])

            // Bundle and wait
            await sendBundleNow({ altoRpc })
            await new Promise((resolve) => setTimeout(resolve, 1500))

            // Get receipts
            const [receipt1, receipt2] = await Promise.all([
                client1.getUserOperationReceipt({ hash: hash1 }),
                client2.getUserOperationReceipt({ hash: hash2 })
            ])

            // Verify both receipts are in same tx
            expect(receipt1.receipt.transactionHash).toEqual(
                receipt2.receipt.transactionHash
            )

            expect(receipt1.logs).length(1)
            expect(receipt2.logs).length(1)

            // Decode and verify correct messages
            const decode = (log: any) =>
                decodeEventLog({
                    abi: eventHelperAbi,
                    data: log.data,
                    topics: log.topics
                })

            expect(decode(receipt1.logs[0]).args).toEqual({ message: "Op1" })
            expect(decode(receipt2.logs[0]).args).toEqual({ message: "Op2" })
        })
    }
)
