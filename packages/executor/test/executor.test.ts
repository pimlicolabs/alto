import { type ChildProcess } from "child_process"
import { concat, encodeFunctionData, parseEther, getContract, getAbiItem, RpcTransaction, TestClient } from "viem"

import { privateKeyToAccount, Account, generatePrivateKey } from "viem/accounts"
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
import { TEST_OP, createOp, generateAccounts, getSender } from "./utils"
import { SenderManager } from "../src/senderManager"

const MINE_WAIT_TIME = 200

const getPendingTransactions = async (testClient: TestClient, ): Promise<RpcTransaction[]> => {
    const pendingTxs = (await testClient.getTxpoolContent()).pending
    return Object.values(pendingTxs).flatMap((txs) => Object.values(txs))
}

describe("executor", () => {
    let clients: Clients
    let anvilProcess: ChildProcess
    let entryPoint: Address
    let simpleAccountFactory: Address

    let signer: Account
    let signer2: Account

    let executor: BasicExecutor

    beforeEach(async function () {
        // destructure the return value
        anvilProcess = await launchAnvil()
        const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
        const privateKey2 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"


        signer = privateKeyToAccount(privateKey)
        signer2 = privateKeyToAccount(privateKey2)
        clients = await createClients(signer)
        entryPoint = await deployContract(clients, signer.address, EntryPointAbi, [], EntryPoint_bytecode)

        const logger = initDebugLogger("silent")

        const accounts: Account[] = await generateAccounts(clients)
        const senderManager = new SenderManager(accounts, logger)

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
            senderManager,
            entryPoint,
            100,
            logger
        )

        await clients.test.setAutomine(false)
    })

    afterEach(async function () {
        anvilProcess.kill()
    })

    it("should be able to send transaction", async function () {
        this.timeout(10000)

        const op = await createOp(entryPoint, simpleAccountFactory, signer, clients)

        expect(await clients.test.getAutomine()).toEqual(false)
        await executor.bundle(entryPoint, op)

        const pendingTxs = await getPendingTransactions(clients.test)
        expect(pendingTxs).toHaveLength(1)
        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))
        const logs = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" }),
            args: {
                userOpHash: getUserOpHash(op, entryPoint, foundry.id)
            }
        })
        expect(logs).toHaveLength(1)
        expect(logs[0].args.success).toEqual(true)

        expect(executor.senderManager.wallets).toHaveLength(10)
    })

    it("should fail if op maxFeePerGas is lower than network gasPrice", async function () {
        this.timeout(10000)

        const op = await createOp(entryPoint, simpleAccountFactory, signer, clients, 1n)

        expect(await clients.test.getAutomine()).toEqual(false)
        await expect(executor.bundle(entryPoint, op)).toBeRejectedWith(/user operation maxFeePerGas too low/)
        const pendingTxs = await getPendingTransactions(clients.test)
        expect(pendingTxs).toHaveLength(0)

        expect(executor.senderManager.wallets).toHaveLength(10)
    })

    it("should resend transaction is tx gas price is lower than current gas price", async function () {
        this.timeout(10000)

        const op = await createOp(entryPoint, simpleAccountFactory, signer, clients)
        const opHash = getUserOpHash(op, entryPoint, foundry.id)

        expect(await clients.test.getAutomine()).toEqual(false)
        await executor.bundle(entryPoint, op)

        const pendingTxs = await getPendingTransactions(clients.test)
        expect(pendingTxs).toHaveLength(1)
        const block = await clients.public.getBlock({
            blockTag: "latest"
        })
        await clients.test.setNextBlockBaseFeePerGas({
            baseFeePerGas: block.baseFeePerGas! * 10n
        })
        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))
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
        const replacedPendingTxs = await getPendingTransactions(clients.test)
        expect(replacedPendingTxs).toHaveLength(1)
        expect(replacedPendingTxs).not.toEqual(pendingTxs)
        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))

        const logsAgain = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" }),
            args: {
                userOpHash: opHash
            }
        })

        const pendingTxsAfterMining = await getPendingTransactions(clients.test)
        expect(pendingTxsAfterMining).toHaveLength(0)

        expect(logsAgain.length).toEqual(1)
        expect(logsAgain[0].args.success).toEqual(true)

        expect(executor.senderManager.wallets).toHaveLength(10)
    })

    it("should not send transaction if tx will fail", async function () {
        this.timeout(10000)

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
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))
        await executor.bundle(entryPoint, op)
        const pendingTxs = await getPendingTransactions(clients.test)
        expect(pendingTxs.map((val) => val.from)).not.toInclude(signer2.address)
        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))
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

    it("should be able to handle multiple ops from different senders", async function () {
        this.timeout(10000)

        const op1 = await createOp(entryPoint, simpleAccountFactory, signer, clients)
        const op2 = await createOp(entryPoint, simpleAccountFactory, signer2, clients)

        expect(await clients.test.getAutomine()).toEqual(false)
        await Promise.all([
            executor.bundle(entryPoint, op1),
            executor.bundle(entryPoint, op2)
        ])

        const pendingTxs = await getPendingTransactions(clients.test)
        expect(pendingTxs).toHaveLength(2)

        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))

        const logs = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" })
        })

        const pendingTxsAfter = await getPendingTransactions(clients.test)
        expect(pendingTxsAfter).toHaveLength(0)

        expect(logs).toHaveLength(2)
        expect(logs[0].args.success).toEqual(true)
        expect(logs[1].args.success).toEqual(true)

        expect(executor.senderManager.wallets).toHaveLength(10)
    })

    it("should be able to handle multiple ops from different senders after gas price increase", async function () {
        this.timeout(10000)

        const op1 = await createOp(entryPoint, simpleAccountFactory, signer, clients)
        const op2 = await createOp(entryPoint, simpleAccountFactory, signer2, clients)

        expect(await clients.test.getAutomine()).toEqual(false)
        await Promise.all([
            executor.bundle(entryPoint, op1),
            executor.bundle(entryPoint, op2)
        ])

        const pendingTxs = await getPendingTransactions(clients.test)
        expect(pendingTxs).toHaveLength(2)

        const block = await clients.public.getBlock({
            blockTag: "latest"
        })
        await clients.test.setNextBlockBaseFeePerGas({
            baseFeePerGas: block.baseFeePerGas! * 10n
        })

        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))

        const logsFirst = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" })
        })

        const pendingTxsAfterFirst = await getPendingTransactions(clients.test)
        expect(pendingTxsAfterFirst).toHaveLength(2)

        expect(logsFirst).toHaveLength(0)

        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))

        const logsSecond = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" })
        })

        const pendingTxsAfterSecond = await getPendingTransactions(clients.test)
        expect(pendingTxsAfterSecond).toHaveLength(0)

        expect(logsSecond).toHaveLength(2)
        expect(logsSecond[0].args.success).toEqual(true)
        expect(logsSecond[1].args.success).toEqual(true)

        expect(executor.senderManager.wallets).toHaveLength(10)
    })

    it("should be able to handle exhaustion of wallets using ops from different senders after gas price increase and frontrunning", async function () {
        this.timeout(10000)

        const entryPointContract = getContract({
            address: entryPoint,
            abi: EntryPointAbi,
            publicClient: clients.public,
            walletClient: clients.wallet
        })

        expect(executor.senderManager.wallets).toHaveLength(10)
        const signers = await generateAccounts(clients)

        const ops = await Promise.all(signers.map(async (signer) => {
            return await createOp(entryPoint, simpleAccountFactory, signer, clients)
        }))

        await Promise.all(ops.map(async (op) => executor.bundle(entryPoint, op)))
        expect(executor.senderManager.wallets).toHaveLength(0)
        expect(await getPendingTransactions(clients.test)).toHaveLength(10)

        const extraOp = await createOp(entryPoint, simpleAccountFactory, signer2, clients)
        const bundlePromise = executor.bundle(entryPoint, extraOp) // this can't fulfill yet because there are no wallets left
        expect(executor.senderManager.wallets).toHaveLength(0)
        expect(await getPendingTransactions(clients.test)).toHaveLength(10)

        const block = await clients.public.getBlock({
            blockTag: "latest"
        })

        await clients.test.setNextBlockBaseFeePerGas({
            baseFeePerGas: block.baseFeePerGas! * 10n
        })

        // frontrun the first op
        const frontrunTx = await entryPointContract.write.handleOps([[ops[0]], signer2.address], {
            account: signer2,
            chain: clients.wallet.chain,
            maxFeePerGas: block.baseFeePerGas! * 100n
        })

        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))

        const logsFirst = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" })
        })

        const pendingTxsAfterFirst = await getPendingTransactions(clients.test)
        expect(pendingTxsAfterFirst).toHaveLength(10) // extraOp should have entered the mempool and the first op should have been frontrun and removed
        expect(executor.senderManager.wallets).toHaveLength(0)

        expect(logsFirst).toHaveLength(1)
        expect(logsFirst[0].transactionHash).toEqual(frontrunTx)

        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))

        const logsSecond = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({ abi: EntryPointAbi, name: "UserOperationEvent" })
        })

        const pendingTxsAfterSecond = await getPendingTransactions(clients.test)
        expect(pendingTxsAfterSecond).toHaveLength(0)

        expect(logsSecond).toHaveLength(10)
        expect(logsSecond.map((log) => log.args.success)).toEqual([true, true, true, true, true, true, true, true, true, true])
        expect(executor.senderManager.wallets).toHaveLength(10)
    })
})
