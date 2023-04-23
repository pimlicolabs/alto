import { type ChildProcess } from "child_process"
import { getContract, concat, parseEther, encodeFunctionData } from "viem"
import { privateKeyToAccount, Account } from "viem/accounts"
import { foundry } from "viem/chains"
import {
    Clients,
    createClients,
    deployContract,
    getUserOpHash,
    launchAnvil,
    parseSenderAddressError
} from "@alto/utils"
import { expect } from "earl"
import { RpcHandler } from "@alto/api"
import { RpcHandlerConfig } from "@alto/config"
import { Address, EntryPoint_bytecode, EntryPointAbi, hexNumberSchema, UserOperation } from "@alto/types"
import { z } from "zod"
import { UnsafeValidator } from "@alto/validator"
import { SimpleAccountFactoryAbi, SimpleAccountFactoryBytecode } from "@alto/types/src/contracts/SimpleAccountFactory"
import { NullExecutor } from "@alto/executor/src"

describe("handler", () => {
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
        const validator = new UnsafeValidator(clients.public, entryPoint)
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

            expect(chainId).toEqual(BigInt(anvilChainId))
        })
    })

    describe("eth_estimateUserOperationGas", () => {
        it("correctly returns gas for valid op", async function () {
            const entryPointContract = getContract({
                address: entryPoint,
                abi: EntryPointAbi,
                publicClient: clients.public,
                walletClient: clients.wallet
            })

            const simpleAccountFactoryContract = getContract({
                address: simpleAccountFactory,
                abi: SimpleAccountFactoryAbi,
                publicClient: clients.public,
                walletClient: clients.wallet
            })

            const initCode = concat([
                simpleAccountFactory,
                encodeFunctionData({
                    abi: SimpleAccountFactoryAbi,
                    functionName: "createAccount",
                    args: [signer.address, 0n]
                })
            ])

            const sender = await entryPointContract.simulate
                .getSenderAddress([initCode])
                .then((_) => {
                    throw new Error("Expected error")
                })
                .catch((e: Error) => {
                    return parseSenderAddressError(e)
                })

            // const { result, request } = await simpleAccountFactoryContract.simulate.createAccount(
            //     [signer.address, 0n],
            //     {
            //         account: signer,
            //         chain: foundry
            //     }
            // )

            await clients.test.setBalance({ address: sender, value: parseEther("1") })

            // await clients.wallet.writeContract(request)
            // await clients.test.mine({ blocks: 1 })

            const op: UserOperation = {
                sender,
                nonce: 0n,
                initCode: initCode,
                callData: "0x",
                callGasLimit: 100_000n,
                verificationGasLimit: 1_000_000n,
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
                    callGasLimit: hexNumberSchema,
                    preVerificationGas: hexNumberSchema,
                    verificationGas: hexNumberSchema
                })
            )
        })
    })
})
