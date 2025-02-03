import type { EntryPointVersion } from "viem/account-abstraction"
import { beforeEach, describe, expect, inject, test } from "vitest"
import { beforeEachCleanUp, getSmartAccountClient } from "../src/utils/index.js"
import {
    getRevertCall,
    deployRevertingContract
} from "../src/revertingContract.js"
import { type Address, BaseError } from "viem"

describe.each([
    {
        entryPointVersion: "0.6" as EntryPointVersion
    },
    {
        entryPointVersion: "0.7" as EntryPointVersion
    }
])(
    "$entryPointVersion supports eth_estimateUserOperationGas",
    ({ entryPointVersion }) => {
        let revertingContract: Address

        const anvilRpc = inject("anvilRpc")
        const altoRpc = inject("altoRpc")

        beforeEach(async () => {
            revertingContract = await deployRevertingContract({
                anvilRpc
            })
            await beforeEachCleanUp({ anvilRpc, altoRpc })
        })

        test("Can estimate with empty gasLimit values", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const gasParams = await smartAccountClient.estimateUserOperationGas(
                {
                    calls: [
                        {
                            to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                            data: "0x",
                            value: 0n
                        }
                    ],
                    callGasLimit: 0n,
                    verificationGasLimit: 0n,
                    preVerificationGas: 0n
                }
            )

            expect(gasParams.verificationGasLimit).not.toBeNull()
            expect(gasParams.preVerificationGas).not.toBeNull()
            expect(gasParams.callGasLimit).not.toBeNull()
        })

        test("Throws if gasPrices are set to zero", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            await expect(async () =>
                smartAccountClient.estimateUserOperationGas({
                    calls: [
                        {
                            to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                            data: "0x",
                            value: 0n
                        }
                    ],
                    maxFeePerGas: 0n,
                    maxPriorityFeePerGas: 0n
                })
            ).rejects.toThrow()
        })

        // error occurs when calling contract that doesn't exist or due to low level evm revert.
        // both of these scenarios return 0x when calling simulateHandleOp.
        test("Gracefully handles cannot decode zero bytes 0x error", async () => {
            if (entryPointVersion === "0.7") {
                return
            }

            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            try {
                await smartAccountClient.estimateUserOperationGas({
                    calls: [
                        {
                            to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                            data: "0x",
                            value: 0n
                        }
                    ],
                    initCode: "0x01" /* this causes the 0x */
                })
            } catch (e: any) {
                expect(e.details).toBe(
                    "AA23 reverted: UserOperation called non-existant contract, or reverted with 0x"
                )
            }
        })

        test("Empty paymaster data results in zero paymaster limits", async () => {
            if (entryPointVersion === "0.6") {
                return
            }

            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const estimation =
                await smartAccountClient.estimateUserOperationGas({
                    calls: [
                        {
                            to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                            data: "0x",
                            value: 0n
                        }
                    ]
                })

            expect(estimation.paymasterPostOpGasLimit).toBe(0n)
            expect(estimation.paymasterVerificationGasLimit).toBe(0n)
        })

        test("Should throw revert reason if simulation reverted during callphase", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            try {
                await smartAccountClient.estimateUserOperationGas({
                    calls: [
                        {
                            to: revertingContract,
                            data: getRevertCall("foobar"),
                            value: 0n
                        }
                    ]
                })
            } catch (e: any) {
                expect(e).toBeInstanceOf(BaseError)
                const err = e.walk()
                expect(err.reason).toEqual("foobar")
            }
        })
    }
)
