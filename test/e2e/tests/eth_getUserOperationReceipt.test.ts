import type { Address, Hex } from "viem"
import {
    type EntryPointVersion,
    entryPoint06Address,
    entryPoint07Address
} from "viem/account-abstraction"
import { beforeAll, beforeEach, describe, expect, test } from "vitest"
import {
    decodeRevert,
    deployRevertingContract,
    getRevertCall
} from "../src/revertingContract"
import { deployPaymaster } from "../src/testPaymaster"
import { beforeEachCleanUp, getSmartAccountClient } from "../src/utils"

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
    "$entryPointVersion supports eth_getUserOperationReceipt",
    ({ entryPoint, entryPointVersion }) => {
        let revertingContract: Address
        let paymaster: Address

        beforeAll(async () => {
            revertingContract = await deployRevertingContract()
            paymaster = await deployPaymaster(entryPoint)
        })

        beforeEach(async () => {
            await beforeEachCleanUp()
        })

        test("Returns revert bytes when UserOperation reverts", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion
            })

            const hash = await smartAccountClient.sendUserOperation({
                calls: [
                    {
                        to: revertingContract,
                        data: getRevertCall("foobar"),
                        value: 0n
                    }
                ],
                callGasLimit: 500_000n,
                verificationGasLimit: 500_000n,
                preVerificationGas: 500_000n
            })

            await new Promise((resolve) => setTimeout(resolve, 1500))

            const receipt = await smartAccountClient.getUserOperationReceipt({
                hash
            })

            expect(receipt).not.toBeNull()
            expect(receipt?.success).toEqual(false)
            expect(decodeRevert(receipt?.reason as Hex)).toEqual("foobar")
        })

        test("Returns paymaster when one is used", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion
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
