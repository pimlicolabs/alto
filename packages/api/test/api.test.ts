import { type ChildProcess } from "child_process"
import { createPublicClient, getContract, createWalletClient, http, parseEther, toHex } from "viem"
import { privateKeyToAccount, Account } from "viem/accounts"
import { foundry } from "viem/chains"
import { Clients, createClients, deployContract, getUserOpHash, launchAnvil } from "@alto/utils"
import { expect, mockObject } from "earl"
import { RpcHandler } from "@alto/api"
import { RpcHandlerConfig } from "@alto/config"
import {
    Address,
    EntryPoint_bytecode,
    EntryPointAbi,
    estimateUserOperationGasResponseSchema,
    UserOperation
} from "@alto/types"
import { z } from "zod"
import { EmptyValidator, IValidator } from "@alto/validator"
import { SimpleAccountFactoryAbi, SimpleAccountFactoryBytecode } from "@alto/types/src/contracts/SimpleAccountFactory"
import { MemoryMempool } from "@alto/mempool"
import { NullExecutor } from "@alto/executor/src"
import { hexNumberRawSchema } from "@alto/types/src"

describe("rpcHandler", () => {
    let clients: Clients
    let anvilProcess: ChildProcess
    let entryPoint: Address
    let simpleAccountFactory: Address
    let handler: RpcHandler

    let signer: Account

    before(async function () {
        // destructure the return value
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
        const mempool = new MemoryMempool(clients.public)
        const validator = new EmptyValidator(clients.public, entryPoint)
        const rpcHandlerConfig: RpcHandlerConfig = {
            publicClient: clients.public,
            chainId: anvilChainId,
            entryPoint: entryPoint
        }
        handler = new RpcHandler(rpcHandlerConfig, validator, new NullExecutor())
    })

    after(function () {
        anvilProcess.kill()
    })

    describe("eth_chainId", () => {
        it("matches rpc chainId", async function () {
            const anvilChainId = await clients.public.getChainId()
            const chainId = await handler.eth_chainId()

            expect(chainId).toEqual(toHex(anvilChainId))
        })
    })

    describe("eth_estimateUserOperationGas", () => {
        it("works", async function () {
            const entryPointContract = getContract({
                address: entryPoint,
                abi: EntryPointAbi,
                publicClient: clients.public
            })

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

            const sender = result

            await clients.test.setBalance({ address: sender, value: parseEther("1") })

            await clients.wallet.writeContract(request)
            await clients.test.mine({ blocks: 1 })

            const op: UserOperation = {
                sender: sender,
                nonce: 0n,
                initCode: "0x",
                callData: "0x",
                callGasLimit: 100_000n,
                verificationGasLimit: 100_000n,
                preVerificationGas: 60_000n,
                maxFeePerGas: 1n,
                maxPriorityFeePerGas: 1n,
                paymasterAndData: "0x",
                signature: "0x"
            }

            const opHash = getUserOpHash(op, entryPoint, foundry.id)

            const signature = await clients.wallet.signMessage({ account: signer, message: opHash })
            op.signature = signature

            const gas = await handler.eth_estimateUserOperationGas(op, entryPoint)

            expect(gas).toMatchSchema(
                z.object({
                    callGasLimit: hexNumberRawSchema,
                    preVerificationGas: hexNumberRawSchema,
                    verificationGas: hexNumberRawSchema
                })
            )
        })
    })
})
