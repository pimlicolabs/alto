import {
    parseGwei,
    type Address,
    type Hex,
    concat,
    encodeFunctionData
} from "viem"
import {
    type UserOperation,
    getUserOperationHash,
    entryPoint07Abi,
    toPackedUserOperation,
    entryPoint06Address,
    entryPoint07Address
} from "viem/account-abstraction"
import { beforeAll, beforeEach, describe, expect, inject, test } from "vitest"
import {
    decodeRevert,
    deployRevertingContract,
    getRevertCall
} from "../src/revertingContract.js"
import { deployPaymaster } from "../src/testPaymaster.js"
import {
    beforeEachCleanUp,
    getPublicClient,
    getSmartAccountClient
} from "../src/utils/index.js"
import { deepHexlify } from "permissionless"
import { foundry } from "viem/chains"
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
    "$entryPointVersion supports eth_getUserOperationReceipt",
    ({ entryPoint, entryPointVersion }) => {
        let revertingContract: Address
        let paymaster: Address

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
                    entryPointVersion:
                        getViemEntryPointVersion(entryPointVersion)
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
    }
)
