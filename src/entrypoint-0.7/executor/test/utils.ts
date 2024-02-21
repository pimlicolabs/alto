import {
    type Address,
    EntryPointAbi,
    type HexData,
    UnPackedUserOperation
} from "@entrypoint-0.7/types"
import { SimpleAccountFactoryAbi } from "@entrypoint-0.7/types"
import {
    type Clients,
    getUserOpHash,
    parseSenderAddressError
} from "@entrypoint-0.7/utils"
import {
    type Account,
    concat,
    encodeFunctionData,
    getContract,
    parseEther
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { foundry } from "viem/chains"

export const TEST_OP: UnPackedUserOperation = {
    sender: "0x0000000000000000000000000000000000000000",
    nonce: 0n,
    factory: null,
    factoryData: null,
    callData: "0x",
    callGasLimit: 100_000n,
    verificationGasLimit: 1_000_000n,
    preVerificationGas: 60_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    paymaster: null,
    paymasterData: null,
    paymasterPostOpGasLimit: null,
    paymasterVerificationGasLimit: null,
    signature: "0x"
}

export async function getSender(
    entryPoint: Address,
    initCode: HexData,
    clients: Clients
): Promise<Address> {
    const entryPointContract = getContract({
        address: entryPoint,
        abi: EntryPointAbi,
        publicClient: clients.public
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

    return sender
}

export async function createOp(
    entryPoint: Address,
    simpleAccountFactory: Address,
    signer: Account,
    clients: Clients,
    maxFeePerGas?: bigint,
    nonce?: bigint
): Promise<UnPackedUserOperation> {
    const initCode = concat([
        simpleAccountFactory,
        encodeFunctionData({
            abi: SimpleAccountFactoryAbi,
            functionName: "createAccount",
            args: [signer.address, 0n]
        })
    ])

    const sender = await getSender(entryPoint, initCode, clients)

    const op = Object.assign({}, TEST_OP)
    op.sender = sender
    op.factory = simpleAccountFactory
    op.factoryData = encodeFunctionData({
        abi: SimpleAccountFactoryAbi,
        functionName: "createAccount",
        args: [signer.address, 0n]
    })
    op.nonce = nonce ?? 0n
    op.maxFeePerGas = maxFeePerGas ?? (await clients.public.getGasPrice())

    const opHash = getUserOpHash(op, entryPoint, foundry.id)

    const signature = await clients.wallet.signMessage({
        account: signer,
        message: { raw: opHash }
    })
    op.signature = signature

    return op
}

export const generateAccounts = async (clients: Clients) => {
    const accountsPromises = [...Array(10)].map(async (_) => {
        const privateKey = generatePrivateKey()
        const account = privateKeyToAccount(privateKey)
        await clients.test.setBalance({
            address: account.address,
            value: parseEther("100")
        })
        return account
    })

    const accounts = await Promise.all(accountsPromises)
    return accounts
}
