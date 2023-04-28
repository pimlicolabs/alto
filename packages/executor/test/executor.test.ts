import { type ChildProcess } from "child_process"
import { concat, encodeFunctionData, parseEther, getContract, getAbiItem } from "viem"

import { privateKeyToAccount, Account } from "viem/accounts"
import { foundry } from "viem/chains"
import {
    Clients,
    createClients,
    deployContract,
    getUserOpHash,
    initDebugLogger,
    initProductionLogger,
    launchAnvil,
    parseSenderAddressError
} from "@alto/utils"
import { expect } from "earl"
import { Address, EntryPoint_bytecode, EntryPointAbi, HexData32, UserOperation } from "@alto/types"
import { SimpleAccountFactoryAbi, SimpleAccountFactoryBytecode } from "@alto/types/src/contracts/SimpleAccountFactory"
import { BasicExecutor } from "../src"
import { getSender } from "./utils"

const TEST_OP: UserOperation = {
    sender: "0x0000000000000000000000000000000000000000",
    nonce: 0n,
    initCode: "0x",
    callData: "0x",
    callGasLimit: 100_000n,
    verificationGasLimit: 1_000_000n,
    preVerificationGas: 60_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    paymasterAndData: "0x",
    signature: "0x"
}

describe("executor", () => {
    let clients: Clients
    let anvilProcess: ChildProcess
    let entryPoint: Address
    let simpleAccountFactory: Address

    let signer: Account

    let executor: BasicExecutor

    beforeEach(async function () {
        // destructure the return value
        anvilProcess = await launchAnvil()
        const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
        signer = privateKeyToAccount(privateKey)
        clients = await createClients(signer)
        entryPoint = await deployContract(clients, signer.address, EntryPointAbi, [], EntryPoint_bytecode)
        simpleAccountFactory = await deployContract(
            clients,
            signer.address,
            SimpleAccountFactoryAbi,
            [entryPoint],
            SimpleAccountFactoryBytecode
        )
        executor = new BasicExecutor(
            signer.address,
            clients.public,
            clients.wallet,
            signer,
            entryPoint,
            100,
            initDebugLogger("fatal")
        )

        await clients.test.setAutomine(false)
    })

    afterEach(function () {
        anvilProcess.kill()
    })

    describe("when there is a user operation", () => {
        it("should be able to send transaction", async function () {
            this.timeout(10000)

            const initCode = concat([
                simpleAccountFactory,
                encodeFunctionData({
                    abi: SimpleAccountFactoryAbi,
                    functionName: "createAccount",
                    args: [signer.address, 0n]
                })
            ])

            const sender = await getSender(entryPoint, initCode, clients)

            await clients.test.setBalance({ address: sender, value: parseEther("1") })

            const op = TEST_OP
            op.sender = sender
            op.initCode = initCode
            op.maxFeePerGas = await clients.public.getGasPrice()

            const opHash = getUserOpHash(op, entryPoint, foundry.id)

            const signature = await clients.wallet.signMessage({ account: signer, message: opHash })
            op.signature = signature

            expect(await clients.test.getAutomine()).toEqual(false)
            await executor.bundle(entryPoint, op)

            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const lowerCaseSigner: HexData32 = signer.address.toLowerCase()
            const pendingTxs = Object.values((await clients.test.getTxpoolContent()).pending[lowerCaseSigner])
            expect(pendingTxs).toHaveLength(1)
            await clients.test.mine({ blocks: 1 })
            await new Promise((resolve) => setTimeout(resolve, 1000))
            const logs = await clients.public.getLogs({
                fromBlock: 0n,
                toBlock: "latest",
                address: entryPoint,
                event: getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" }),
                args: {
                    userOpHash: opHash
                }
            })
            expect(logs).toHaveLength(1)
            expect(logs[0].args.success).toEqual(true)
        })

        it("should fail if op maxFeePerGas is lower than network gasPrice", async function () {
            this.timeout(10000)

            const initCode = concat([
                simpleAccountFactory,
                encodeFunctionData({
                    abi: SimpleAccountFactoryAbi,
                    functionName: "createAccount",
                    args: [signer.address, 0n]
                })
            ])

            const sender = await getSender(entryPoint, initCode, clients)

            await clients.test.setBalance({ address: sender, value: parseEther("1") })

            const op = TEST_OP
            op.sender = sender
            op.initCode = initCode
            op.maxFeePerGas = 1n

            const opHash = getUserOpHash(op, entryPoint, foundry.id)

            const signature = await clients.wallet.signMessage({ account: signer, message: opHash })
            op.signature = signature

            expect(await clients.test.getAutomine()).toEqual(false)
            await expect(executor.bundle(entryPoint, op)).toBeRejectedWith(/user operation maxFeePerGas too low/)
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const pendingTxs = Object.keys((await clients.test.getTxpoolContent()).pending)
            expect(pendingTxs).toHaveLength(0)
        })

        it("should resend transaction is tx gas price is lower than current gas price", async function () {
            this.timeout(10000)

            const initCode = concat([
                simpleAccountFactory,
                encodeFunctionData({
                    abi: SimpleAccountFactoryAbi,
                    functionName: "createAccount",
                    args: [signer.address, 1n]
                })
            ])

            const sender = await getSender(entryPoint, initCode, clients)

            await clients.test.setBalance({ address: sender, value: parseEther("1") })

            const op = TEST_OP
            op.sender = sender
            op.initCode = initCode
            op.maxFeePerGas = await clients.public.getGasPrice()

            const opHash = getUserOpHash(op, entryPoint, foundry.id)

            const signature = await clients.wallet.signMessage({ account: signer, message: opHash })
            op.signature = signature

            expect(await clients.test.getAutomine()).toEqual(false)
            await executor.bundle(entryPoint, op)

            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const lowerCaseSigner: HexData32 = signer.address.toLowerCase()
            const pendingTxs = Object.values((await clients.test.getTxpoolContent()).pending[lowerCaseSigner])
            expect(pendingTxs).toHaveLength(1)
            const block = await clients.public.getBlock({
                blockTag: "latest"
            })
            await clients.test.setNextBlockBaseFeePerGas({
                baseFeePerGas: block.baseFeePerGas! * 10n
            })
            await clients.test.mine({ blocks: 1 })
            await new Promise((resolve) => setTimeout(resolve, 1000))
            const logs = await clients.public.getLogs({
                fromBlock: 0n,
                toBlock: "latest",
                address: entryPoint,
                event: getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" }),
                args: {
                    userOpHash: opHash
                }
            })
            expect(logs).toHaveLength(0)
            const repalcedPendingTxs = Object.values((await clients.test.getTxpoolContent()).pending[lowerCaseSigner])
            expect(repalcedPendingTxs).toHaveLength(1)
            expect(repalcedPendingTxs).not.toEqual(pendingTxs)
            await clients.test.mine({ blocks: 1 })
            await new Promise((resolve) => setTimeout(resolve, 1000))

            const logsAgain = await clients.public.getLogs({
                fromBlock: 0n,
                toBlock: "latest",
                address: entryPoint,
                event: getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" }),
                args: {
                    userOpHash: opHash
                }
            })

            const pendingTxsAfterMining = Object.keys((await clients.test.getTxpoolContent()).pending)
            expect(pendingTxsAfterMining).toHaveLength(0)

            expect(logsAgain.length).toEqual(1)
            expect(logsAgain[0].args.success).toEqual(true)
        })

        it("should not send transaction if tx will fail", async function () {
            this.timeout(10000)

            const signer2 = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d")

            const initCode = concat([
                simpleAccountFactory,
                encodeFunctionData({
                    abi: SimpleAccountFactoryAbi,
                    functionName: "createAccount",
                    args: [signer.address, 2n]
                })
            ])

            const entryPointContract = getContract({
                address: entryPoint,
                abi: EntryPointAbi,
                publicClient: clients.public,
                walletClient: clients.wallet
            })

            const sender = await getSender(entryPoint, initCode, clients)

            await clients.test.setBalance({ address: sender, value: parseEther("1") })

            const op = TEST_OP
            op.sender = sender
            op.initCode = initCode
            op.maxFeePerGas = await clients.public.getGasPrice()

            const opHash = getUserOpHash(op, entryPoint, foundry.id)

            const signature = await clients.wallet.signMessage({ account: signer, message: opHash })
            op.signature = signature

            expect(await clients.test.getAutomine()).toEqual(false)
            await entryPointContract.write.handleOps([[op], signer2.address], {
                account: signer2,
                chain: clients.wallet.chain
            })
            await clients.test.mine({ blocks: 1 })
            await new Promise((resolve) => setTimeout(resolve, 100))
            await executor.bundle(entryPoint, op)
            const pendingTxsSenders = Object.keys((await clients.test.getTxpoolContent()).pending)
            expect(pendingTxsSenders).not.toInclude(signer2.address)
            await clients.test.mine({ blocks: 1 })
            await new Promise((resolve) => setTimeout(resolve, 100))
            const logsAgain = await clients.public.getLogs({
                fromBlock: 0n,
                toBlock: "latest",
                address: entryPoint,
                event: getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" }),
                args: {
                    userOpHash: opHash
                }
            })
            expect(logsAgain.length).toEqual(1)
            const successfulTx = await clients.public.getTransaction({ hash: logsAgain[0].transactionHash! })
            expect(successfulTx.from.toLowerCase()).toEqual(signer2.address.toLowerCase())
        })
    })
})
