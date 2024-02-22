// biome-ignore lint/nursery/noNodejsModules: <explanation>
import { type ChildProcess, exec } from "child_process"
import type {
    HexData,
    HexData32,
    UnPackedUserOperation
} from "@entrypoint-0.7/types"
import { entryPointExecutionErrorSchema } from "@entrypoint-0.7/types"
import * as sentry from "@sentry/node"
import { type Abi } from "abitype"
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
    createWalletClient
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { type Chain, foundry } from "viem/chains"
import { fromZodError } from "zod-validation-error"
import { getUserOperationHash, toPackedUserOperation } from "./userop"

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
    op: UnPackedUserOperation,
    entryPoint: Address,
    chainId: number
): HexData32 {
    return getUserOperationHash(toPackedUserOperation(op), entryPoint, chainId)
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
