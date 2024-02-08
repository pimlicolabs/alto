import { ChildProcess } from "child_process"
import {
    BasicExecutor,
    IExecutor,
    NullExecutor,
    SenderManager
} from "@entrypoint-0.6/executor"
import { createOp, generateAccounts } from "@entrypoint-0.6/executor/test/utils"
import {
    Address,
    EntryPointAbi,
    EntryPoint_bytecode,
    SimpleAccountFactoryAbi,
    SimpleAccountFactoryBytecode,
    SubmissionStatus,
    TransactionInfo,
    UserOperationMempoolEntry,
    UserOperationStatus
} from "@entrypoint-0.6/types"
import {
    Clients,
    createClients,
    createMetrics,
    deployContract,
    getUserOpHash,
    initDebugLogger,
    launchAnvil
} from "@entrypoint-0.6/utils"
import { MockObject, expect, mockFn, mockObject } from "earl"
import { Registry } from "prom-client"
import { Account } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { foundry } from "viem/chains"
import { MemoryMempool } from ".."
import { Monitor } from "../monitoring" // Update the import path according to your project structure

describe("mempool", () => {
    let clients: Clients
    let anvilProcess: ChildProcess
    let entryPoint: Address
    let simpleAccountFactory: Address

    let signer: Account
    let signer2: Account

    let executor: MockObject<IExecutor>
    let mempool: MemoryMempool

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
            metrics
        )

        simpleAccountFactory = await deployContract(
            clients,
            signer.address,
            SimpleAccountFactoryAbi,
            [entryPoint],
            SimpleAccountFactoryBytecode
        )

        // executor = new BasicExecutor(
        //     signer.address,
        //     clients.public,
        //     clients.wallet,
        //     senderManager,
        //     entryPoint,
        //     logger,
        //     metrics,
        //     true
        // )

        executor = mockObject<IExecutor>({
            bundle: mockFn()
        })

        mempool = new MemoryMempool(
            executor,
            new Monitor(),
            clients.public,
            entryPoint,
            1000,
            logger,
            metrics
        )

        await clients.test.setAutomine(false)
    })

    it("should add op to mempool", async function () {
        const op = await createOp(
            entryPoint,
            simpleAccountFactory,
            signer,
            clients
        )
        const opHash = getUserOpHash(op, entryPoint, foundry.id)

        const success = mempool.add(op, opHash)
        expect(success).toEqual(true)

        const retrievedOp = mempool.get(opHash)
        expect(retrievedOp).not.toBeNullish()

        expect(retrievedOp!.status).toEqual(SubmissionStatus.NotSubmitted)
        expect(retrievedOp!.userOperationInfo.userOperation).toEqual(op)
        expect(retrievedOp!.userOperationInfo.userOperationHash).toEqual(opHash)
    })

    it("should bundle correctly", async function () {
        const op = await createOp(
            entryPoint,
            simpleAccountFactory,
            signer,
            clients
        )
        const opHash = getUserOpHash(op, entryPoint, foundry.id)

        const success = mempool.add(op, opHash)
        expect(success).toEqual(true)

        const mockResult: UserOperationMempoolEntry[] = [
            {
                status: SubmissionStatus.Submitted,
                userOperationInfo: {
                    userOperation: op,
                    userOperationHash: opHash,
                    lastReplaced: Date.now(),
                    firstSubmitted: Date.now()
                },
                transactionInfo: {
                    transactionHash: "0x1234"
                } as unknown as TransactionInfo
            }
        ]

        executor.bundle.returns(new Promise((resolve) => resolve(mockResult)))

        await mempool.bundle()

        const retrievedOp = mempool.get(opHash)
        expect(retrievedOp).not.toBeNullish()

        expect(retrievedOp!.status).toEqual(SubmissionStatus.Submitted)
        expect(retrievedOp!.userOperationInfo.userOperation).toEqual(op)
        expect(retrievedOp!.userOperationInfo.userOperationHash).toEqual(opHash)
    })
})
