import { HexData, UserOperation } from "@alto/types"
import { Abi, parseAbiParameters } from "abitype"
import { exec, type ChildProcess } from "child_process"
import {
    Address,
    PublicClient,
    TestClient,
    WalletClient,
    createPublicClient,
    createTestClient,
    createWalletClient,
    encodeAbiParameters,
    http,
    keccak256
} from "viem"
import { foundry } from "viem/chains"

export type Clients = {
    public: PublicClient
    test: TestClient
    wallet: WalletClient
}

export const launchAnvil = async (): Promise<ChildProcess> => {
    const anvilProcess = exec(`anvil`)

    const client = createPublicClient({
        chain: foundry,
        transport: http()
    })

    // keep calling getNetwork every 2ms until it doesn't throw
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await client.getChainId()
            break
        } catch (e) {
            await new Promise((resolve) => setTimeout(resolve, 2))
        }
    }

    return anvilProcess
}

export const createClients = async (): Promise<Clients> => {
    const publicClient = createPublicClient({
        chain: foundry,
        transport: http("http://127.0.0.1:8545")
    })

    try {
        await publicClient.getChainId()
    } catch {
        throw new Error("anvil is not running")
    }

    const testClient = createTestClient({
        chain: foundry,
        transport: http("http://127.0.0.1:8545"),
        mode: "anvil"
    })

    const walletClient = createWalletClient({
        chain: foundry,
        transport: http("http://127.0.0.1:8545"),
        key: testClient.key
    })

    return {
        public: publicClient,
        test: testClient,
        wallet: walletClient
    }
}

export const deployContract = async (
    clients: Clients,
    deployer: Address,
    abi: Abi,
    args: any[],
    bytecode: HexData
): Promise<Address> => {
    if (clients.wallet.chain === undefined) {
        throw new Error("chain is undefined")
    }

    const hash = await clients.wallet.deployContract({
        abi: abi,
        account: deployer,
        bytecode,
        args,
        chain: clients.wallet.chain
    })

    await clients.test.mine({ blocks: 1 })

    const rcp = await clients.public.waitForTransactionReceipt({ hash })

    const contractAddress = rcp.contractAddress
    if (contractAddress === null) {
        throw new Error("contract deployment failed")
    }

    return contractAddress
}

export function getUserOpHash(op: UserOperation, entryPoint: Address, chainId: number): string {
    const hashedUserOp = {
        sender: op.sender,
        nonce: op.nonce,
        initCodeHash: keccak256(op.initCode),
        callDataHash: keccak256(op.callData),
        callGasLimit: op.callGasLimit,
        verificationGasLimit: op.verificationGasLimit,
        preVerificationGas: op.preVerificationGas,
        maxFeePerGas: op.maxFeePerGas,
        maxPriorityFeePerGas: op.maxPriorityFeePerGas,
        paymasterAndDataHash: keccak256(op.paymasterAndData)
    }

    const userOpType = {
        components: [
            { type: "address", name: "sender" },
            { type: "uint256", name: "nonce" },
            { type: "bytes32", name: "initCodeHash" },
            { type: "bytes32", name: "callDataHash" },
            { type: "uint256", name: "callGasLimit" },
            { type: "uint256", name: "verificationGasLimit" },
            { type: "uint256", name: "preVerificationGas" },
            { type: "uint256", name: "maxFeePerGas" },
            { type: "uint256", name: "maxPriorityFeePerGas" },
            { type: "bytes32", name: "paymasterAndDataHash" }
        ],
        name: "hashedUserOp",
        type: "tuple"
    }
    const encoded: HexData = encodeAbiParameters([userOpType], [{ ...hashedUserOp }])
    // remove leading word (total length) and trailing word (zero-length signature)

    const userOpHash = keccak256(encoded)
    const enc = encodeAbiParameters(parseAbiParameters("bytes32, address, uint256"), [
        userOpHash,
        entryPoint,
        BigInt(chainId)
    ])
    return keccak256(enc)
}
