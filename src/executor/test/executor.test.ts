import type { ChildProcess } from "child_process"
import {
    RpcTransaction,
    TestClient,
    concat,
    encodeFunctionData,
    getAbiItem,
    getContract
} from "viem"

import {
    Address,
    EntryPointAbi,
    EntryPoint_bytecode,
    SubmissionStatus
} from "@alto/types"
import {
    SimpleAccountFactoryAbi,
    SimpleAccountFactoryBytecode
} from "@alto/types"
import {
    Clients,
    createClients,
    createMetrics,
    deployContract,
    getUserOpHash,
    initDebugLogger,
    launchAnvil
} from "@alto/utils"
import { expect } from "earl"
import { Registry } from "prom-client"
import { Account, privateKeyToAccount } from "viem/accounts"
import { foundry } from "viem/chains"
import { BasicExecutor } from ".."
import { SenderManager } from ".."
import { TEST_OP, createOp, generateAccounts, getSender } from "./utils"

const MINE_WAIT_TIME = 300

const getPendingTransactions = async (
    testClient: TestClient
): Promise<RpcTransaction[]> => {
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

    beforeEach(async () => {
        // destructure the return value
        anvilProcess = await launchAnvil()
        const privateKey =
            "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
        const privateKey2 =
            "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"

        signer = privateKeyToAccount(privateKey)
        signer2 = privateKeyToAccount(privateKey2)
        clients = await createClients(signer)
        entryPoint = await deployContract(
            clients,
            signer.address,
            EntryPointAbi,
            [],
            EntryPoint_bytecode
        )

        const logger = initDebugLogger("silent")

        const accounts: Account[] = await generateAccounts(clients)

        const metrics = createMetrics(new Registry(), false)

        const senderManager = new SenderManager(
            accounts,
            accounts[0],
            logger,
            metrics,
            true,
            "v1"
        )

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
            logger,
            metrics,
            true
        )

        await clients.test.setAutomine(false)
    })

    afterEach(async () => {
        anvilProcess.kill()
    })

    it("should be able to send transaction", async function () {
        this.timeout(10000)

        const op = await createOp(
            entryPoint,
            simpleAccountFactory,
            signer,
            clients
        )

        const opHash = getUserOpHash(op, entryPoint, foundry.id)

        expect(await clients.test.getAutomine()).toEqual(false)
        const result = await executor.bundle(entryPoint, [op])
        expect(result).toHaveLength(1)

        if (result[0].status !== SubmissionStatus.Submitted) {
            throw new Error("expected bundle result to be submitted")
        }

        expect(result[0].status).toEqual(SubmissionStatus.Submitted)
        expect(result[0].userOperationInfo.userOperation).toEqual(op)
        expect(result[0].userOperationInfo.userOperationHash).toEqual(opHash)

        const pendingTxs = await getPendingTransactions(clients.test)
        expect(pendingTxs).toHaveLength(1)
        await clients.test.mine({ blocks: 1 })

        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))
        const logs = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({
                abi: EntryPointAbi,
                name: "UserOperationEvent"
            }),
            args: {
                userOpHash: opHash
            }
        })
        expect(logs).toHaveLength(1)
        expect(logs[0].args.success).toEqual(true)

        await executor.markProcessed(result[0].transactionInfo)

        expect(executor.senderManager.availableWallets).toHaveLength(10)
    })

    it("should fail if op maxFeePerGas is lower than network gasPrice", async function () {
        this.skip()
        /*
        this.timeout(10000)

        const op = await createOp(entryPoint, simpleAccountFactory, signer, clients, 1n)

        expect(await clients.test.getAutomine()).toEqual(false)
        await expect(executor.bundle(entryPoint, op)).toBeRejectedWith(/user operation maxFeePerGas too low/)
        const pendingTxs = await getPendingTransactions(clients.test)
        expect(pendingTxs).toHaveLength(0)

        const opHash = getUserOpHash(op, entryPoint, foundry.id)
        const status = monitor.getUserOperationStatus(opHash)
        expect(status.status).toEqual("not_found")
        expect(status.transactionHash).toBeNullish()

        expect(executor.senderManager.wallets).toHaveLength(10)
        */
    })

    it("should be able to resubmit transaction", async function () {
        this.timeout(10000)

        const op = await createOp(
            entryPoint,
            simpleAccountFactory,
            signer,
            clients
        )

        const opHash = getUserOpHash(op, entryPoint, foundry.id)

        expect(await clients.test.getAutomine()).toEqual(false)
        const result = await executor.bundle(entryPoint, [op])
        expect(result).toHaveLength(1)
        if (result[0].status !== SubmissionStatus.Submitted) {
            throw new Error("expected bundle result to be submitted")
        }

        expect(result[0].status).toEqual(SubmissionStatus.Submitted)
        expect(result[0].userOperationInfo.userOperation).toEqual(op)
        expect(result[0].userOperationInfo.userOperationHash).toEqual(opHash)

        const pendingTxs = await getPendingTransactions(clients.test)
        expect(pendingTxs).toHaveLength(1)
        expect(pendingTxs[0].hash).toEqual(
            result[0].transactionInfo.transactionHash
        )

        const newTxInfo = await executor.replaceTransaction(
            result[0].transactionInfo
        )
        expect(newTxInfo).not.toBeNullish()

        const pendingTxs2 = await getPendingTransactions(clients.test)
        expect(pendingTxs2).toHaveLength(1)

        expect(pendingTxs2[0].hash).toEqual(newTxInfo!.transactionHash)
        expect(pendingTxs2[0].hash).not.toEqual(
            result[0].transactionInfo.transactionHash
        )

        await clients.test.mine({ blocks: 1 })

        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))
        const logs = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({
                abi: EntryPointAbi,
                name: "UserOperationEvent"
            }),
            args: {
                userOpHash: opHash
            }
        })

        expect(logs).toHaveLength(1)
        expect(logs[0].args.success).toEqual(true)
        expect(logs[0].transactionHash).toEqual(newTxInfo!.transactionHash)

        await executor.markProcessed(result[0].transactionInfo)

        expect(executor.senderManager.availableWallets).toHaveLength(10)

        /*
        this.timeout(10000)

        const op = await createOp(entryPoint, simpleAccountFactory, signer, clients)
        const opHash = getUserOpHash(op, entryPoint, foundry.id)

        expect(await clients.test.getAutomine()).toEqual(false)
        await executor.bundle(entryPoint, [op])

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

        expect(executor.senderManager.availableWallets).toHaveLength(10)
        */
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

        // no balance
        // await clients.test.setBalance({ address: sender, value: parseEther("1") })

        const op = TEST_OP
        op.sender = sender
        op.initCode = initCode
        op.maxFeePerGas = await clients.public.getGasPrice()

        const opHash = getUserOpHash(op, entryPoint, foundry.id)

        const signature = await clients.wallet.signMessage({
            account: signer,
            message: { raw: opHash }
        })
        op.signature = signature

        expect(await clients.test.getAutomine()).toEqual(false)
        await entryPointContract.write.handleOps([[op], signer2.address], {
            account: signer2,
            chain: clients.wallet.chain
        })
        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))
        const bundleResults = await executor.bundle(entryPoint, [op])
        expect(bundleResults).toHaveLength(1)

        if (bundleResults[0].status !== SubmissionStatus.Rejected) {
            throw new Error("expected bundle result to be rejected")
        }
        expect(bundleResults[0].status).toEqual(SubmissionStatus.Rejected)
        expect(bundleResults[0].userOperationInfo.userOperation).toEqual(op)
        expect(bundleResults[0].reason).toMatchRegex(/AA/)

        const pendingTxs = await getPendingTransactions(clients.test)
        expect(pendingTxs.map((val) => val.from)).not.toInclude(signer2.address)
        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))
        const logsAgain = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({
                abi: EntryPointAbi,
                name: "UserOperationEvent"
            }),
            args: {
                userOpHash: opHash
            }
        })
        expect(logsAgain.length).toEqual(1)
        const successfulTx = await clients.public.getTransaction({
            hash: logsAgain[0].transactionHash
        })
        expect(successfulTx.from.toLowerCase()).toEqual(
            signer2.address.toLowerCase()
        )
    })

    it("should be able to handle multiple ops from different senders", async function () {
        this.timeout(10000)

        const op1 = await createOp(
            entryPoint,
            simpleAccountFactory,
            signer,
            clients
        )
        const op2 = await createOp(
            entryPoint,
            simpleAccountFactory,
            signer2,
            clients
        )

        expect(await clients.test.getAutomine()).toEqual(false)
        await Promise.all([
            executor.bundle(entryPoint, [op1]),
            executor.bundle(entryPoint, [op2])
        ])

        const pendingTxs = await getPendingTransactions(clients.test)
        expect(pendingTxs).toHaveLength(2)

        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))

        const logs = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({
                abi: EntryPointAbi,
                name: "UserOperationEvent"
            })
        })

        const pendingTxsAfter = await getPendingTransactions(clients.test)
        expect(pendingTxsAfter).toHaveLength(0)

        expect(logs).toHaveLength(2)
        expect(logs[0].args.success).toEqual(true)
        expect(logs[1].args.success).toEqual(true)

        expect(executor.senderManager.availableWallets).toHaveLength(10)
    })

    it("should be able to handle multiple ops from different senders after gas price increase", async function () {
        this.timeout(10000)

        const op1 = await createOp(
            entryPoint,
            simpleAccountFactory,
            signer,
            clients
        )
        const op2 = await createOp(
            entryPoint,
            simpleAccountFactory,
            signer2,
            clients
        )

        expect(await clients.test.getAutomine()).toEqual(false)
        await Promise.all([
            executor.bundle(entryPoint, [op1]),
            executor.bundle(entryPoint, [op2])
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
            event: getAbiItem({
                abi: EntryPointAbi,
                name: "UserOperationEvent"
            })
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
            event: getAbiItem({
                abi: EntryPointAbi,
                name: "UserOperationEvent"
            })
        })

        const pendingTxsAfterSecond = await getPendingTransactions(clients.test)
        expect(pendingTxsAfterSecond).toHaveLength(0)

        expect(logsSecond).toHaveLength(2)
        expect(logsSecond[0].args.success).toEqual(true)
        expect(logsSecond[1].args.success).toEqual(true)

        expect(executor.senderManager.availableWallets).toHaveLength(10)
    })

    it("should be able to handle exhaustion of wallets using ops from different senders after gas price increase and frontrunning", async function () {
        this.timeout(10000)

        const entryPointContract = getContract({
            address: entryPoint,
            abi: EntryPointAbi,
            publicClient: clients.public,
            walletClient: clients.wallet
        })

        expect(executor.senderManager.availableWallets).toHaveLength(10)
        const signers = await generateAccounts(clients)

        const ops = await Promise.all(
            signers.map(async (signer) => {
                return await createOp(
                    entryPoint,
                    simpleAccountFactory,
                    signer,
                    clients
                )
            })
        )
        // mempool: []
        // waiting: []

        await Promise.all(
            ops.map(async (op) => executor.bundle(entryPoint, [op]))
        )
        // mempool: [op1tx, op2tx, op3tx, op4tx, op5tx, op6tx, op7tx, op8tx, op9tx, op10tx]
        // waiting: []

        expect(executor.senderManager.availableWallets).toHaveLength(0)
        expect(await getPendingTransactions(clients.test)).toHaveLength(10)

        const extraOp = await createOp(
            entryPoint,
            simpleAccountFactory,
            signer2,
            clients
        )
        // mempool: [op1tx, op2tx, op3tx, op4tx, op5tx, op6tx, op7tx, op8tx, op9tx, op10tx]
        // waiting: [extraOp]

        const bundlePromise = executor.bundle(entryPoint, [extraOp]) // this can't fulfill yet because there are no wallets left
        expect(executor.senderManager.availableWallets).toHaveLength(0)
        expect(await getPendingTransactions(clients.test)).toHaveLength(10)

        const block = await clients.public.getBlock({
            blockTag: "latest"
        })

        await clients.test.setNextBlockBaseFeePerGas({
            baseFeePerGas: block.baseFeePerGas! * 10n
        })

        // frontrun the first op
        const frontrunTx = await entryPointContract.write.handleOps(
            [[ops[0]], signer2.address],
            {
                account: signer2,
                chain: clients.wallet.chain,
                maxFeePerGas: block.baseFeePerGas! * 100n
            }
        )

        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))

        // mempool: [newOp1tx, newOp2tx, newOp3tx, newOp4tx, newOp5tx, newOp6tx, newOp7tx, newOp8tx, newOp9tx, newOp10tx]
        // waiting: [extraOp]

        const logsFirst = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({
                abi: EntryPointAbi,
                name: "UserOperationEvent"
            })
        })

        const pendingTxsAfterFirst = await getPendingTransactions(clients.test)
        expect(pendingTxsAfterFirst).toHaveLength(10) // extraOp should have entered the mempool and the first op should have been frontrun and removed
        expect(executor.senderManager.availableWallets).toHaveLength(0)

        expect(logsFirst).toHaveLength(1)
        expect(logsFirst[0].transactionHash).toEqual(frontrunTx)

        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))

        // mempool: [extraOpTx]
        // waiting: []

        const logsSecond = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({
                abi: EntryPointAbi,
                name: "UserOperationEvent"
            })
        })

        const pendingTxsAfterSecond = await getPendingTransactions(clients.test)
        expect(pendingTxsAfterSecond).toHaveLength(1)

        expect(logsSecond).toHaveLength(10)
        expect(logsSecond.map((log) => log.args.success)).toEqual([
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true
        ])

        expect(executor.senderManager.availableWallets).toHaveLength(9)

        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))

        expect(await getPendingTransactions(clients.test)).toHaveLength(0)
    })

    it("should reject op if it is already being bundled", async function () {
        this.timeout(10000)

        const op = await createOp(
            entryPoint,
            simpleAccountFactory,
            signer,
            clients
        )

        await executor.bundle(entryPoint, [op])

        const pendingTxs = await getPendingTransactions(clients.test)
        expect(pendingTxs).toHaveLength(1)

        await expect(executor.bundle(entryPoint, [op])).toBeRejected()

        await clients.test.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, MINE_WAIT_TIME))

        const latestBlock = await clients.public.getBlock()
        expect(latestBlock.transactions).toHaveLength(1)
        const logs = await clients.public.getLogs({
            fromBlock: 0n,
            toBlock: "latest",
            address: entryPoint,
            event: getAbiItem({
                abi: EntryPointAbi,
                name: "UserOperationEvent"
            }),
            args: {
                userOpHash: getUserOpHash(op, entryPoint, foundry.id)
            }
        })
        expect(logs).toHaveLength(1)
        expect(logs[0].args.success).toEqual(true)

        expect(executor.senderManager.availableWallets).toHaveLength(10)
    })
})
