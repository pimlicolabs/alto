import { type ChildProcess } from "child_process"
import { TestClient, createTestClient, getContract, http} from "viem"
import { privateKeyToAccount, Account } from "viem/accounts"
import { foundry } from "viem/chains"
import { Clients, createClients, deployContract, getUserOpHash, launchAnvil } from "@alto/utils"
import { expect } from "earl"
import { Address, EntryPoint_bytecode, EntryPointAbi, UserOperation } from "@alto/types"
import { SimpleAccountFactoryAbi, SimpleAccountFactoryBytecode } from "@alto/types/src/contracts/SimpleAccountFactory"
import { BasicExecutor } from "../src"

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
        await clients.test.setAutomine(false)
    })

    after(function () {
        anvilProcess.kill()
    })

    describe("when there is a user operation", () => {
        before(async function () {
            const factory = getContract({
                address: simpleAccountFactory,
                abi: SimpleAccountFactoryAbi,
                publicClient: clients.public,
                walletClient: clients.wallet
            })
        })

        it("should be able to send transaction", async function () {
            this.timeout(20000)
            expect(await clients.test.getAutomine()).toEqual(false);
            await clients.test.setIntervalMining({
                interval: 2,
            })
    
            const tx = await executor.bundle(entryPoint, []);
            executor.monitorTx(tx)

            await new Promise((resolve) => setTimeout(resolve, 10000))        
        })

        it.only("should resend transaction is tx gas price is lower than current gas price", async function () {
            this.timeout(200000)
            expect(await clients.test.getAutomine()).toEqual(false);
            const tx = await executor.bundle(entryPoint, []);
            const maxFeePerGas = await clients.public.getTransaction({
                hash: tx
            }).then((t) => t.maxFeePerGas)
            console.log("=maxFeePerGas", maxFeePerGas)
            await clients.test.setNextBlockBaseFeePerGas({
                baseFeePerGas: maxFeePerGas! + 1n
            })
            executor.monitorTx(tx)
            // await clients.test.mine({
            //     blocks: 1
            // })
            await clients.test.setIntervalMining({
                interval: 1,
            })
            await new Promise((resolve) => setTimeout(resolve, 20000))        
        })
    })
})
