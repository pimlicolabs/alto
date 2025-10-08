import {
    decodeNonce,
    encodeNonce,
    getRequiredPrefund
} from "permissionless/utils"
import {
    http,
    type Address,
    BaseError,
    type Hex,
    RpcRequestError,
    concat,
    createPublicClient,
    createTestClient,
    getContract,
    pad,
    parseEther,
    parseGwei,
    zeroAddress
} from "viem"
import {
    type EntryPointVersion,
    type UserOperation,
    UserOperationReceiptNotFoundError,
    entryPoint06Address,
    entryPoint07Address,
    entryPoint08Address
} from "viem/account-abstraction"
import {
    generatePrivateKey,
    privateKeyToAccount,
    privateKeyToAddress
} from "viem/accounts"
import { foundry } from "viem/chains"
import { beforeEach, describe, expect, inject, test } from "vitest"
import { ERC7769Errors } from "../src/errors.js"
import { deployPaymaster, encodePaymasterData } from "../src/testPaymaster.js"
import { getEntryPointAbi } from "../src/utils/entrypoint.js"
import {
    beforeEachCleanUp,
    getSimple7702AccountImplementationAddress,
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

        test("Should throw if EntryPoint is not supported", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const fakeEntryPoint = privateKeyToAddress(generatePrivateKey())

            try {
                await smartAccountClient.estimateUserOperationGas({
                    calls: [
                        {
                            to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                            data: "0x",
                            value: 0n
                        }
                    ],
                    entryPointAddress: fakeEntryPoint
                })
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                expect(error.details).toMatch(/EntryPoint .* not supported/)

                // Check for RPC error code
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.InvalidFields)
            }
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
                abi: getEntryPointAbi(entryPointVersion),
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
                (log) => decodeNonce(log.args.nonce as bigint).key
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
                abi: getEntryPointAbi(entryPointVersion),
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

            try {
                await client.sendUserOperation(op) // second should fail due to "already known"
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                expect(error.details).toMatch(/Already known/i)

                // Check for RPC error code
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.InvalidFields)
            }
        })

        test("Should send userOp with 7702Auth", async () => {
            const privateKey = generatePrivateKey()
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                privateKey,
                anvilRpc,
                altoRpc,
                use7702: true
            })

            const owner = privateKeyToAccount(privateKey)

            const authorization = await owner.signAuthorization({
                chainId: foundry.id,
                nonce: await publicClient.getTransactionCount({
                    address: owner.address
                }),
                contractAddress:
                    getSimple7702AccountImplementationAddress(entryPointVersion)
            })

            const hash = await smartAccountClient.sendUserOperation({
                calls: [
                    {
                        to: zeroAddress,
                        data: "0x",
                        value: 0n
                    }
                ],
                authorization
            })

            await new Promise((resolve) => setTimeout(resolve, 1500))

            const receipt =
                await smartAccountClient.waitForUserOperationReceipt({ hash })

            expect(receipt.success)
        })

        test.each([
            {
                sponsored: false,
                testName: "Should bundle 10 userOps sent sequentially"
            },
            {
                sponsored: true,
                testName: "Should bundle 10 sponsored userOps sent sequentially"
            }
        ])("$testName", async ({ sponsored }) => {
            // Skip for v0.6 - doesn't support queued userOps
            if (entryPointVersion === "0.6") {
                return
            }

            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            // Deploy the account and wait for confirmation
            const deployHash = await client.sendUserOperation({
                calls: [
                    {
                        to: client.account.address,
                        value: 0n,
                        data: "0x"
                    }
                ]
            })
            await client.waitForUserOperationReceipt({ hash: deployHash })

            // Now switch to manual bundling for the test
            await setBundlingMode({
                mode: "manual",
                altoRpc
            })

            const entryPointContract = getContract({
                address: entryPoint,
                abi: getEntryPointAbi(entryPointVersion),
                client: {
                    public: publicClient
                }
            })

            // Get starting nonce after deployment
            const startNonce = (await entryPointContract.read.getNonce([
                client.account.address,
                0n // nonce key
            ])) as bigint

            const userOpHashes: Hex[] = []
            const numOps = 10

            // Send 10 userOps with incremental nonces (with or without paymaster)
            for (let i = 0; i < numOps; i++) {
                const userOpHash = await client.sendUserOperation({
                    calls: [
                        {
                            to: TO_ADDRESS,
                            value: parseEther("0.001"),
                            data: "0x"
                        }
                    ],
                    nonce: startNonce + BigInt(i),
                    ...(sponsored
                        ? {
                              paymaster: paymaster,
                              paymasterVerificationGasLimit: 100_000n,
                              paymasterPostOpGasLimit: 50_000n,
                              paymasterData: encodePaymasterData()
                          }
                        : {})
                })
                userOpHashes.push(userOpHash)
            }

            // Bundle them all
            await sendBundleNow({ altoRpc })

            // Verify all receipts are successful
            const receipts = await Promise.all(
                userOpHashes.map(async (hash) => {
                    const receipt = await client.waitForUserOperationReceipt({
                        hash
                    })
                    return receipt
                })
            )

            // Verify all ops were included
            expect(receipts.every((receipt) => receipt.success)).toEqual(true)

            // Verify final nonce is correct
            const finalNonce = (await entryPointContract.read.getNonce([
                client.account.address,
                0n
            ])) as bigint
            expect(finalNonce).toEqual(startNonce + BigInt(numOps))

            // If sponsored, verify paymaster was used.
            if (sponsored) {
                expect(
                    receipts.every((receipt) => receipt.paymaster === paymaster)
                ).toEqual(true)
            }
        })

        // ============================================================
        // Error Validation Tests
        // Tests that verify proper error handling and AA error codes
        // ============================================================

        test("Should throw AA10: sender already constructed", async () => {
            const privateKey = generatePrivateKey()
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                privateKey
            })

            // Prepare the first userOp with deployment data.
            const firstOp = (await client.prepareUserOperation({
                calls: [
                    {
                        to: client.account.address,
                        value: 0n,
                        data: "0x"
                    }
                ]
            })) as UserOperation
            firstOp.signature = await client.account.signUserOperation(firstOp)

            // Deploy the account.
            const deployHash = await client.sendUserOperation(firstOp)
            await client.waitForUserOperationReceipt({ hash: deployHash })

            // prepare a second userOp.
            const secondOp = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Force the deployment data from firstOp even though account is already deployed.
            if (entryPointVersion === "0.6") {
                secondOp.initCode = firstOp.initCode
            } else {
                secondOp.factory = firstOp.factory
                secondOp.factoryData = firstOp.factoryData
            }

            secondOp.signature =
                await client.account.signUserOperation(secondOp)

            try {
                await client.sendUserOperation(secondOp)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(
                    /(AA10|sender already constructed)/i
                )

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.SimulateValidation)
            }
        })

        test("Should throw AA13: initCode failed or OOG", async () => {
            const privateKey = generatePrivateKey()
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                privateKey
            })

            // Prepare a userOp with deployment data
            const op = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Set very low verificationGasLimit to trigger OOG during deployment
            op.verificationGasLimit = 10_000n

            op.signature = await client.account.signUserOperation(op)

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(/(AA13|initCode failed or OOG)/i)

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.SimulateValidation)
            }
        })

        test("Should throw AA14: initCode must return sender", async () => {
            const privateKey = generatePrivateKey()
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                privateKey
            })

            // Create a temporary client with different private key to get wrong factory data
            const wrongPrivateKey = generatePrivateKey()
            const tempClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                privateKey: wrongPrivateKey
            })

            // Prepare userOp from temp client to get factory data for wrong address
            const tempOp = (await tempClient.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Prepare userOp from actual client
            const op = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Use factory data from wrong account but keep correct sender
            if (entryPointVersion === "0.6") {
                op.initCode = tempOp.initCode
            } else {
                op.factory = tempOp.factory
                op.factoryData = tempOp.factoryData
            }

            op.signature = await client.account.signUserOperation(op)

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(
                    /(AA14|initCode must return sender)/i
                )

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.SimulateValidation)
            }
        })

        // Testcase for AA15: initCode must create sender

        test("Should throw AA20: account not deployed", async () => {
            const privateKey = generatePrivateKey()
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                privateKey
            })

            // Attempt to send a userOp without deploying the account first
            // (and without initCode/factory for deployment)
            const op = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Remove deployment data to trigger AA20
            if (entryPointVersion === "0.6") {
                op.initCode = "0x"
            } else {
                op.factory = undefined
                op.factoryData = undefined
            }

            op.signature = await client.account.signUserOperation(op)

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(/(AA20|Account not deployed)/i)

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.SimulateValidation)
            }
        })

        test("Should throw AA21: insufficient prefund", async () => {
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
                entryPointVersion: entryPointVersion
            })

            // Should throw when there is insufficient prefund
            await anvilClient.setBalance({
                address: client.account.address,
                value: requiedPrefund - 1n
            })

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(/(AA21|didn't pay prefund)/i)

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.SimulateValidation)
            }

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

        // Should throw AA22 expired or not due

        test("Should throw AA23: reverted (account validation)", async () => {
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

            // Use a malformed signature that will cause ECDSA.recover to revert
            // ECDSA library expects 65 bytes (r: 32, s: 32, v: 1), using invalid length causes revert
            op.signature = "0xdeadbeef" as Hex // FAILING CONDITION: Invalid signature format

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(/(AA23|reverted)/i)

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.SimulateValidation)
            }
        })

        // Should throw AA23: reverted

        test("Should throw AA24: signature error", async () => {
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

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(
                    /(AA24|Invalid UserOperation signature or paymaster signature)/i
                )

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.InvalidSignature)
            }
        })

        test("Should throw AA25: invalid account nonce", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const entryPointContract = getContract({
                address: entryPoint,
                abi: getEntryPointAbi(entryPointVersion),
                client: {
                    public: publicClient
                }
            })

            // Get current nonce
            const currentNonce = (await entryPointContract.read.getNonce([
                client.account.address,
                0n // nonce key
            ])) as bigint

            // Try to send with nonce + 1 (should fail)
            try {
                await client.sendUserOperation({
                    calls: [
                        {
                            to: TO_ADDRESS,
                            value: VALUE,
                            data: "0x"
                        }
                    ],
                    nonce: currentNonce + 1n
                })
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(/(AA25|Invalid account nonce)/i)

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.SimulateValidation)
            }
        })

        test("Should throw AA26: over verificationGasLimit", async () => {
            // Skip for v0.6 - this is a 0.7 only error
            if (entryPointVersion === "0.6") {
                return
            }

            const privateKey = generatePrivateKey()
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                privateKey
            })

            // Deploy the account first to avoid AA13 error
            const deployHash = await client.sendUserOperation({
                calls: [
                    {
                        to: client.account.address,
                        value: 0n,
                        data: "0x"
                    }
                ]
            })
            await client.waitForUserOperationReceipt({ hash: deployHash })

            // Now prepare a userOp without deployment data
            const op = (await client.prepareUserOperation({
                calls: [
                    {
                        to: TO_ADDRESS,
                        value: VALUE,
                        data: "0x"
                    }
                ]
            })) as UserOperation

            // Set extremely low verificationGasLimit to trigger AA26
            op.verificationGasLimit = 25000n // FAILING CONDITION: Too low for validation
            op.signature = await client.account.signUserOperation(op)

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(
                    /(AA26|over verificationGasLimit)/i
                )

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.SimulateValidation)
            }
        })

        test("Should throw AA30: paymaster not deployed", async () => {
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

            // Use a non-deployed address as paymaster
            const nonDeployedPaymaster = privateKeyToAddress(
                generatePrivateKey()
            )

            if (entryPointVersion === "0.6") {
                op.paymasterAndData = concat([
                    nonDeployedPaymaster,
                    encodePaymasterData()
                ])
            } else {
                op.paymaster = nonDeployedPaymaster // FAILING CONDITION: paymaster not deployed
                op.paymasterVerificationGasLimit = 100_000n
                op.paymasterPostOpGasLimit = 50_000n
                op.paymasterData = encodePaymasterData()
            }

            op.signature = await client.account.signUserOperation(op)

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(/(AA30|paymaster not deployed)/i)

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(
                    ERC7769Errors.SimulatePaymasterValidation
                )
            }
        })

        test("Should throw AA31: paymaster deposit too low", async () => {
            const client = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            // Deploy paymaster without funding
            const unfundedPaymaster = await deployPaymaster({
                entryPoint,
                anvilRpc,
                salt: pad(privateKeyToAddress(generatePrivateKey())),
                funded: false
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

            if (entryPointVersion === "0.6") {
                op.paymasterAndData = concat([
                    unfundedPaymaster,
                    encodePaymasterData()
                ])
            } else {
                op.paymaster = unfundedPaymaster // FAILING CONDITION: paymaster has no deposit
                op.paymasterVerificationGasLimit = 100_000n
                op.paymasterPostOpGasLimit = 50_000n
                op.paymasterData = encodePaymasterData()
            }

            op.signature = await client.account.signUserOperation(op)

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(
                    /(AA31|paymaster deposit too low)/i
                )

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.PaymasterDepositTooLow)
            }
        })

        test("Should throw AA32: paymaster expired or not due", async () => {
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

            // Get current block timestamp
            const publicClient = createPublicClient({
                transport: http(anvilRpc),
                chain: foundry
            })
            const block = await publicClient.getBlock()
            const currentTimestamp = block.timestamp

            // Set validUntil to expired (current timestamp - 1)
            const expiredTimestamp = Number(currentTimestamp) - 1

            if (entryPointVersion === "0.6") {
                op.paymasterAndData = concat([
                    paymaster,
                    encodePaymasterData({
                        validUntil: expiredTimestamp,
                        validAfter: 0
                    })
                ])
            } else {
                op.paymaster = paymaster // FAILING CONDITION: expired validUntil
                op.paymasterVerificationGasLimit = 100_000n
                op.paymasterPostOpGasLimit = 50_000n
                op.paymasterData = encodePaymasterData({
                    validUntil: expiredTimestamp,
                    validAfter: 0
                })
            }

            op.signature = await client.account.signUserOperation(op)

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(
                    /(AA32|paymaster expired or not due|expires too soon)/i
                )

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.ExpiresShortly)
            }
        })

        test("Should throw AA33: reverted", async () => {
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

            if (entryPointVersion === "0.6") {
                op.paymasterAndData = concat([
                    paymaster,
                    encodePaymasterData({ forceRevert: true })
                ])
            } else {
                op.paymaster = paymaster // FAILING CONDITION: paymaster will revert
                op.paymasterVerificationGasLimit = 100_000n
                op.paymasterPostOpGasLimit = 50_000n
                op.paymasterData = encodePaymasterData({ forceRevert: true })
            }

            op.signature = await client.account.signUserOperation(op)

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(/(AA33|reverted|revert)/i)

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(
                    ERC7769Errors.SimulatePaymasterValidation
                )
            }
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

            if (entryPointVersion === "0.6") {
                op.paymasterAndData = concat([
                    paymaster,
                    encodePaymasterData({ invalidSignature: true })
                ])
            } else {
                op.paymaster = paymaster // FAILING CONDITION: invalid signature
                op.paymasterVerificationGasLimit = 100_000n
                op.paymasterPostOpGasLimit = 50_000n
                op.paymasterData = encodePaymasterData({
                    invalidSignature: true
                })
            }

            op.signature = await client.account.signUserOperation(op)

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(
                    /(AA34|Invalid UserOperation signature or paymaster signature)/i
                )

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(ERC7769Errors.InvalidSignature)
            }
        })

        test("Should throw AA36: over paymasterVerificationGasLimit", async () => {
            // Skip for v0.6 - this is a 0.7 only error
            if (entryPointVersion === "0.6") {
                return
            }

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

            // Set paymaster with very low verification gas limit
            op.paymaster = paymaster
            op.paymasterVerificationGasLimit = 1000n // FAILING CONDITION: Too low
            op.paymasterPostOpGasLimit = 50_000n
            op.paymasterData = encodePaymasterData()

            op.signature = await client.account.signUserOperation(op)

            try {
                await client.sendUserOperation(op)
                expect.fail("Must throw")
            } catch (err) {
                expect(err).toBeInstanceOf(BaseError)
                const error = err as BaseError

                // Check top-level error
                expect(error.name).toBe("UserOperationExecutionError")
                expect(error.details).toMatch(
                    /(AA36|over paymasterVerificationGasLimit)/i
                )

                // Check for RPC error code.
                const rpcError = error.walk(
                    (e) => e instanceof RpcRequestError
                ) as RpcRequestError
                expect(rpcError).toBeDefined()
                expect(rpcError.code).toBe(
                    ERC7769Errors.SimulatePaymasterValidation
                )
            }
        })
    }
)
