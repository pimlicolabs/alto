import { type ChildProcess } from "child_process"
import { createPublicClient, getContract, createWalletClient, http, parseEther, toHex } from "viem"
import { privateKeyToAccount, Account } from "viem/accounts"
import { foundry } from "viem/chains"
import { Clients, createClients, deployContract, getUserOpHash, launchAnvil } from "@alto/utils"
import { expect } from "earl"
import { RpcHandler } from "@alto/api"
import { RpcHandlerConfig } from "@alto/config"
import { Address, EntryPoint_bytecode, EntryPointAbi, UserOperation } from "@alto/types"
import { IValidator } from "@alto/validator"
import { SimpleAccountFactoryAbi, SimpleAccountFactoryBytecode } from "@alto/types/src/contracts/SimpleAccountFactory"
import { MemoryMempool } from "@alto/mempool"
import { BasicExecutor } from "../lib"

describe("rpcHandler", () => {
    let clients: Clients
    let anvilProcess: ChildProcess
    let entryPoint: Address
    let simpleAccountFactory: Address

    let signer: Account

    let executor : BasicExecutor

    let mempool: MemoryMempool

    before(async function () {
        // destructure the return value
        anvilProcess = await launchAnvil()
        const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
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
        mempool = new MemoryMempool(
            clients.public,
        )

        executor = new BasicExecutor(
            mempool,
            signer.address,
            clients.public,
            clients.wallet,
            signer,
            "* * * * * *"
        )
    })

    after(function () {
        anvilProcess.kill()
    })

    describe("when there is a user operation", () => {
        before(async function () {
            const userOp: UserOperation = {
                sender: signer.address,
                callData: "0x",
                initCode: "0x",
                paymasterAndData: "0x",
                signature: "0x",
                nonce: 0n,
                callGasLimit: 100_000n,
                preVerificationGas: 10000n,
                verificationGasLimit: 100_000n,
                maxFeePerGas: 100n,
                maxPriorityFeePerGas: 10n
            }
            const userOpHash = await mempool.add(
                entryPoint,
                userOp,
            )
            console.log(userOpHash)
        });

        it("hello", async() => {
            console.log("hello")
            await executor.processBundle();
        })
    })
})
