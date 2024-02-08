// biome-ignore lint/nursery/noNodejsModules: <explanation>
import { type ChildProcess, exec } from "child_process"
import type { HexData, HexData32, UserOperation } from "@entrypoint-0.6/types"
import { entryPointExecutionErrorSchema } from "@entrypoint-0.6/types"
import * as sentry from "@sentry/node"
import { type Abi, parseAbiParameters } from "abitype"
import {
    http,
    type Account,
    type Address,
    type PublicClient,
    type TestClient,
    type Transport,
    type WalletClient,
    createPublicClient,
    createTestClient,
    createWalletClient,
    encodeAbiParameters,
    keccak256
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { type Chain, foundry } from "viem/chains"
import { fromZodError } from "zod-validation-error"

export type Clients = {
    public: PublicClient<Transport, Chain>
    test: TestClient
    wallet: WalletClient<Transport, Chain, Account>
}

export const launchAnvil = async (): Promise<ChildProcess> => {
    const anvilProcess = exec("anvil")

    const client = createPublicClient({
        chain: foundry,
        transport: http()
    })

    // keep calling getNetwork every 2ms until it doesn't throw
    while (true) {
        try {
            await client.getChainId()
            break
        } catch (_e) {
            await new Promise((resolve) => setTimeout(resolve, 2))
        }
    }

    return anvilProcess
}

export const createClients = async (signer?: Account): Promise<Clients> => {
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

    testClient.key

    const walletClient = createWalletClient({
        chain: foundry,
        transport: http("http://127.0.0.1:8545"),
        account: signer ?? privateKeyToAccount(generatePrivateKey())
    })
    // : createWalletClient({
    //       chain: foundry,
    //       transport: http("http://127.0.0.1:8545"),
    //       key: testClient.key
    //   })

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
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
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

export function getUserOpHash(
    op: UserOperation,
    entryPoint: Address,
    chainId: number
): HexData32 {
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
    const encoded: HexData = encodeAbiParameters(
        [userOpType],
        [{ ...hashedUserOp }]
    )
    // remove leading word (total length) and trailing word (zero-length signature)

    const userOpHash = keccak256(encoded)
    const enc = encodeAbiParameters(
        parseAbiParameters("bytes32, address, uint256"),
        [userOpHash, entryPoint, BigInt(chainId)]
    )
    return keccak256(enc)
}

export const parseSenderAddressError = (e: Error): Address => {
    const entryPointExecutionErrorSchemaParsing =
        entryPointExecutionErrorSchema.safeParse(e)
    if (!entryPointExecutionErrorSchemaParsing.success) {
        sentry.captureException(e)
        throw fromZodError(entryPointExecutionErrorSchemaParsing.error)
    }
    const errorData = entryPointExecutionErrorSchemaParsing.data
    if (errorData.errorName !== "SenderAddressResult") {
        sentry.captureException(e)
        throw e
    }
    return errorData.args.sender
}
