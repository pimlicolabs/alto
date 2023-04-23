import { type ChildProcess } from "child_process"
import {  concat, encodeFunctionData, parseEther, getContract, parseAbiItem } from "viem"

import { privateKeyToAccount, Account } from "viem/accounts"
import { foundry } from "viem/chains"
import { Clients, createClients, deployContract, getUserOpHash, launchAnvil, parseSenderAddressError } from "@alto/utils"
import { expect } from "earl"
import { Address, EntryPoint_bytecode, EntryPointAbi, UserOperation } from "@alto/types"
import { SimpleAccountFactoryAbi, SimpleAccountFactoryBytecode } from "@alto/types/src/contracts/SimpleAccountFactory"
import { BasicExecutor } from "../src"

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

    before(async function () {
        // destructure the return value
        anvilProcess = await launchAnvil()
        const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
        signer = privateKeyToAccount(privateKey)
        clients = await createClients(signer)
        console.log(signer.address)
        entryPoint = await deployContract(clients, signer.address, EntryPointAbi, [], EntryPoint_bytecode)
        simpleAccountFactory = await deployContract(
            clients,
            signer.address,
            SimpleAccountFactoryAbi,
            [entryPoint],
            SimpleAccountFactoryBytecode
        )
        executor = new BasicExecutor(signer.address, clients.public, clients.wallet, signer)

        simpleAccountFactory = await deployContract(
            clients,
            signer.address,
            SimpleAccountFactoryAbi,
            [entryPoint],
            SimpleAccountFactoryBytecode
        )
        
        await clients.test.setAutomine(false)
    })

    after(function () {
        anvilProcess.kill()
    })

    describe("when there is a user operation", () => {
        before(async function () {
        })

        it("should be able to send transaction", async function () {
            this.timeout(20000)

            const initCode = concat([
                simpleAccountFactory,
                encodeFunctionData({
                    abi: SimpleAccountFactoryAbi,
                    functionName: "createAccount",
                    args: [signer.address, 0n]
                })
            ])
            const entryPointContract = getContract({
                address: entryPoint,
                abi: EntryPointAbi,
                publicClient: clients.public,
                walletClient: clients.wallet
            })

            const sender = await entryPointContract.simulate
                .getSenderAddress([initCode])
                .then((_) => {
                    throw new Error("Expected error")
                })
                .catch((e: Error) => {
                    return parseSenderAddressError(e)
                })

            await clients.test.setBalance({ address: sender, value: parseEther("1") })

            const op = TEST_OP
            op.sender = sender
            op.initCode = initCode

            const opHash = getUserOpHash(op, entryPoint, foundry.id)

            const signature = await clients.wallet.signMessage({ account: signer, message: opHash })
            op.signature = signature

            expect(await clients.test.getAutomine()).toEqual(false);
            await clients.test.setIntervalMining({
                interval: 2,
            })
            const hash = await executor.bundle(entryPoint, [op]);
            console.log("=hash", hash)
            const rcpt = await clients.public.waitForTransactionReceipt({hash})
            const logs = await clients.public.getLogs({
                fromBlock: 0n,
                toBlock: "latest",
                address: entryPoint,
                event: parseAbiItem("event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)"),
                args:{
                    userOpHash: opHash,
                    sender: sender,
                    nonce: 0n
                }
            })
            expect(logs.length).toEqual(1)
            expect(logs[0].args.success).toEqual(true)
            expect(logs[0].transactionHash).toEqual(hash)
        })

        it("should resend transaction is tx gas price is lower than current gas price", async function () {
            this.timeout(200000)

            const initCode = concat([
                simpleAccountFactory,
                encodeFunctionData({
                    abi: SimpleAccountFactoryAbi,
                    functionName: "createAccount",
                    args: [signer.address, 1n]
                })
            ])
            const entryPointContract = getContract({
                address: entryPoint,
                abi: EntryPointAbi,
                publicClient: clients.public,
                walletClient: clients.wallet
            })

            const sender = await entryPointContract.simulate
                .getSenderAddress([initCode])
                .then((_) => {
                    throw new Error("Expected error")
                })
                .catch((e: Error) => {
                    return parseSenderAddressError(e)
                })

            await clients.test.setBalance({ address: sender, value: parseEther("1") })

            const op = TEST_OP
            op.sender = sender
            op.initCode = initCode

            const opHash = getUserOpHash(op, entryPoint, foundry.id)

            const signature = await clients.wallet.signMessage({ account: signer, message: opHash })
            op.signature = signature

            expect(await clients.test.getAutomine()).toEqual(false);
            const hash = await executor.bundle(entryPoint, [op]);
            console.log("=hash", hash)
            const tx = await clients.public.getTransaction({
                hash
            })
            await clients.test.setNextBlockBaseFeePerGas({
                baseFeePerGas: tx.maxFeePerGas! * 10n
            })
            await clients.test.setIntervalMining({
                interval: 1,
            })
            await new Promise((resolve) => setTimeout(resolve, 5000))
            const logs = await clients.public.getLogs({
                fromBlock: 0n,
                toBlock: "latest",
                address: entryPoint,
                event: parseAbiItem("event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)"),
                args:{
                    userOpHash: opHash,
                    sender: sender,
                    nonce: 0n
                }
            })
            expect(logs.length).toEqual(1)
            expect(logs[0].args.success).toEqual(true)
            expect(logs[0].transactionHash).not.toEqual(hash)
            const newTx = await clients.public.getTransaction({
                hash: logs[0].transactionHash!
            })
            expect(tx.maxFeePerGas).toBeLessThan(newTx.maxFeePerGas)
            console.log("=logs[0].transactionHash", logs[0].transactionHash)
        })
    })
})
