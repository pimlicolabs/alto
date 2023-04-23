import { Address, EntryPointAbi, EntryPoint_bytecode } from "@alto/types"
import { SimpleAccountFactoryAbi, SimpleAccountFactoryBytecode } from "@alto/types/src/contracts/SimpleAccountFactory"
import { Clients, createClients, deployContract, launchAnvil } from "@alto/utils"
import { ChildProcess } from "child_process"
import { Account, getContract } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { UnsafeValidator } from "../src"
import { foundry } from "viem/chains"
import { IValidator } from "../lib"

describe("validator", () => {
    describe("validateUserOperation", () => {
        let clients: Clients
        let anvilProcess: ChildProcess
        let entryPoint: Address
        let simpleAccountFactory: Address
        let validator: IValidator

        let signer: Account

        before(async function () {
            anvilProcess = await launchAnvil()
            const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" // first private key in anvil
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

            const anvilChainId = await clients.public.getChainId()
            const validator = new UnsafeValidator(clients.public, entryPoint)
        })

        it("should return true for a valid user operation", async function () {
            const simpleAccountFactoryContract = getContract({
                address: simpleAccountFactory,
                abi: SimpleAccountFactoryAbi,
                publicClient: clients.public,
                walletClient: clients.wallet
            })

            const { result, request } = await simpleAccountFactoryContract.simulate.createAccount(
                [signer.address, 0n],
                {
                    account: signer,
                    chain: foundry
                }
            )

            validator.validateUserOperation()
        })
    })
})
