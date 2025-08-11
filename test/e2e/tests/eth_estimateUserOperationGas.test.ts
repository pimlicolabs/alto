import { deepHexlify } from "permissionless"
import {
    http,
    type Address,
    BaseError,
    type Hex,
    createPublicClient,
    getContract,
    zeroAddress
} from "viem"
import {
    type EntryPointVersion,
    type UserOperation,
    createBundlerClient,
    entryPoint06Address,
    entryPoint07Address,
    entryPoint08Address
} from "viem/account-abstraction"
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"
import { foundry } from "viem/chains"
import { beforeEach, describe, expect, inject, test } from "vitest"
import {
    deployRevertingContract,
    getRevertCall
} from "../src/revertingContract.js"
import { deployPaymaster } from "../src/testPaymaster.js"
import { getEntryPointAbi } from "../src/utils/entrypoint.js"
import {
    beforeEachCleanUp,
    getSmartAccountClient,
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
    "$entryPointVersion supports eth_estimateUserOperationGas",
    ({ entryPointVersion, entryPoint }) => {
        let revertingContract: Address
        let paymaster: Address

        const anvilRpc = inject("anvilRpc")
        const altoRpc = inject("altoRpc")

        beforeEach(async () => {
            revertingContract = await deployRevertingContract({
                anvilRpc
            })
            await beforeEachCleanUp({ anvilRpc, altoRpc })
            paymaster = await deployPaymaster({
                entryPoint,
                anvilRpc
            })
        })

        test("Should throw if EntryPoint is not supported", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const fakeEntryPoint = privateKeyToAddress(generatePrivateKey())

            await expect(async () =>
                smartAccountClient.estimateUserOperationGas({
                    calls: [
                        {
                            to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                            data: "0x",
                            value: 0n
                        }
                    ],
                    entryPointAddress: fakeEntryPoint
                })
            ).rejects.toThrow(/EntryPoint .* not supported/)
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
                    "UserOperation reverted during simulation with reason: Sender has no code or factory not deployed"
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

        test("No paymaster should result in zero paymaster gas limits", async () => {
            if (entryPointVersion === "0.6") {
                return
            }

            const bundlerClient = createBundlerClient({
                chain: foundry,
                transport: http(altoRpc)
            })

            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const userOp = (await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                        data: "0x",
                        value: 0n
                    }
                ]
            })) as UserOperation<"0.7">

            const estimation = await bundlerClient.estimateUserOperationGas({
                ...userOp,
                paymaster: undefined,
                paymasterData: undefined,
                paymasterVerificationGasLimit: 0n,
                paymasterPostOpGasLimit: 0n,
                entryPointAddress: entryPoint
            })

            expect(estimation.paymasterVerificationGasLimit).toBe(0n)
            expect(estimation.paymasterPostOpGasLimit).toBe(0n)
        })

        test("Empty calldata should result in zero callGasLimit", async () => {
            const bundlerClient = createBundlerClient({
                chain: foundry,
                transport: http(altoRpc)
            })

            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const userOp = (await smartAccountClient.prepareUserOperation({
                callData: "0x"
            })) as UserOperation<"0.7">

            const estimation = await bundlerClient.estimateUserOperationGas({
                ...userOp,
                callData: "0x",
                entryPointAddress: entryPoint
            })

            expect(estimation.callGasLimit).toBe(0n)
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
                expect(err.message).toEqual(
                    "UserOperation reverted during simulation with reason: 0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000006666f6f6261720000000000000000000000000000000000000000000000000000"
                )
                expect(err.code).toEqual(-32521)
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

        test("Should throw AA25 when estimating userOp with nonce + 1", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const publicClient = createPublicClient({
                transport: http(anvilRpc),
                chain: foundry
            })

            const entryPointContract = getContract({
                address: entryPoint,
                abi: getEntryPointAbi(entryPointVersion),
                client: {
                    public: publicClient
                }
            })

            // Get current nonce from entryPoint
            const currentNonce = (await entryPointContract.read.getNonce([
                smartAccountClient.account.address,
                0n // nonce key
            ])) as bigint

            // Try to estimate with nonce + 1 (should fail with AA25)
            await expect(async () => {
                await smartAccountClient.prepareUserOperation({
                    calls: [
                        {
                            to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                            data: "0x",
                            value: 0n
                        }
                    ],
                    nonce: currentNonce + 1n
                })
            }).rejects.toThrowError(
                expect.objectContaining({
                    details: expect.stringMatching(
                        /(AA25|Invalid account nonce)/i
                    )
                })
            )
        })

        test.each([
            {
                sponsored: false,
                testName:
                    "Should estimate userOp with nonce N+3 when N, N+1, N+2 are in mempool"
            },
            {
                sponsored: true,
                testName:
                    "Should estimate sponsored userOp with nonce N+3 when N, N+1, N+2 are in mempool"
            }
        ])("$testName", async ({ sponsored }) => {
            // Skip for v0.6 - doesn't support queued userOps
            if (entryPointVersion === "0.6") {
                return
            }

            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            // Deploy the account first
            const deployHash = await smartAccountClient.sendUserOperation({
                calls: [
                    {
                        to: smartAccountClient.account.address,
                        value: 0n,
                        data: "0x"
                    }
                ]
            })
            await smartAccountClient.waitForUserOperationReceipt({
                hash: deployHash
            })

            // Set bundling mode to manual so ops stay in mempool
            await setBundlingMode({
                mode: "manual",
                altoRpc
            })

            // Get current nonce (should be 1 after deployment)
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                        data: "0x",
                        value: 0n
                    }
                ]
            })

            const currentNonce = userOp.nonce

            // Send 3 userOps to mempool to populate the queue (N, N+1, N+2)
            for (let i = 0; i < 3; i++) {
                await smartAccountClient.sendUserOperation({
                    calls: [
                        {
                            to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                            data: "0x",
                            value: 0n
                        }
                    ],
                    nonce: currentNonce + BigInt(i),
                    ...(sponsored
                        ? {
                              paymaster: paymaster,
                              paymasterVerificationGasLimit: 100_000n,
                              paymasterPostOpGasLimit: 50_000n
                          }
                        : {})
                })
            }

            // Now estimate the 4th userOp (N+3) - this should work
            const userOpN3 = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                        data: "0x",
                        value: 0n
                    }
                ],
                nonce: currentNonce + 3n,
                ...(sponsored && paymaster
                    ? {
                          paymaster: paymaster,
                          paymasterVerificationGasLimit: 100_000n,
                          paymasterPostOpGasLimit: 50_000n
                      }
                    : {})
            })

            // Verify that estimation succeeded and returned valid gas limits
            expect(userOpN3.callGasLimit).toBeGreaterThan(0n)
            expect(userOpN3.verificationGasLimit).toBeGreaterThan(0n)
            expect(userOpN3.preVerificationGas).toBeGreaterThan(0n)

            // If sponsored, verify paymaster gas limits
            if (sponsored) {
                expect(userOpN3.paymasterVerificationGasLimit).toBeGreaterThan(
                    0n
                )
                expect(userOpN3.paymasterPostOpGasLimit).toBeGreaterThan(0n)
            }
        })
    }
)
