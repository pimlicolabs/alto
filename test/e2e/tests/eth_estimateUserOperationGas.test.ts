import {
    UserOperation,
    createBundlerClient,
    entryPoint06Address,
    entryPoint07Address
} from "viem/account-abstraction"
import { beforeEach, describe, expect, inject, test } from "vitest"
import { beforeEachCleanUp, getSmartAccountClient } from "../src/utils/index.js"
import {
    getRevertCall,
    deployRevertingContract
} from "../src/revertingContract.js"
import { type Address, BaseError, Hex, http, zeroAddress } from "viem"
import { deepHexlify } from "permissionless"
import { foundry } from "viem/chains"
import { entryPoint08Address, EntryPointVersion } from "../src/constants.js"

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
    "$entryPointVersion supports eth_estimateUserOperationGas",
    ({ entryPointVersion, entryPoint }) => {
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
            if (entryPointVersion !== "0.6") {
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

        test("Should validate eip7702Auth", async () => {
            let userOp: UserOperation

            if (entryPointVersion === "0.6") {
                userOp = {
                    sender: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    nonce: 0n,
                    initCode: "0x",
                    callData: "0x",
                    callGasLimit: 500_000n,
                    verificationGasLimit: 500_000n,
                    preVerificationGas: 500_000n,
                    maxFeePerGas: 0n,
                    maxPriorityFeePerGas: 0n,
                    paymasterAndData: "0x",
                    signature: "0x"
                }
            } else {
                userOp = {
                    sender: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    nonce: 0n,
                    callData: "0x",
                    callGasLimit: 500_000n,
                    verificationGasLimit: 500_000n,
                    preVerificationGas: 500_000n,
                    maxFeePerGas: 0n,
                    maxPriorityFeePerGas: 0n,
                    paymaster:
                        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address,
                    paymasterData: "0x" as Hex,
                    signature: "0x"
                }
            }

            const stubEip7702Auth = {
                address: "0xffffffffffffffffffffffffffffffffffffffff",
                chainId: foundry.id,
                nonce: "0x0",
                r: "0xd0a9ba6fb478f5e1a3e4eb55c679534f4420b0bdf0e66ce740ec0618e95e2673",
                s: "0x7a807cf75baf2868ba4b15cdcf9803be90657e160f427b9811df3ae4e65e15c4",
                yParity: 1 // Valid values are 0 or 1 for EIP-7702
            }

            const bundlerClient = createBundlerClient({
                chain: foundry,
                transport: http(altoRpc)
            })

            const entryPointAddress = entryPoint

            // check yParity
            await expect(async () => {
                await bundlerClient.request({
                    method: "eth_estimateUserOperationGas",
                    params: [
                        deepHexlify({
                            ...userOp,
                            eip7702Auth: { ...stubEip7702Auth, yParity: 27 }
                        }),
                        entryPointAddress
                    ]
                })
            }).rejects.toThrow(
                "Invalid EIP-7702 authorization: The yParity value must be either 0 or 1"
            )

            await expect(async () => {
                await bundlerClient.request({
                    method: "eth_estimateUserOperationGas",
                    params: [
                        deepHexlify({
                            ...userOp,
                            eip7702Auth: {
                                ...stubEip7702Auth,
                                address: zeroAddress
                            }
                        }),
                        entryPointAddress
                    ]
                })
            }).rejects.toThrow(
                "Invalid EIP-7702 authorization: Cannot delegate to the zero address."
            )
        })
    }
)
