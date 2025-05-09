import {
    type SmartAccountClient,
    createSmartAccountClient
} from "permissionless"
import { toSimpleSmartAccount } from "permissionless/accounts"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import {
    http,
    type Chain,
    type Transport,
    createPublicClient,
    createTestClient,
    createWalletClient,
    parseEther
} from "viem"
import { type SmartAccount, EntryPointVersion } from "viem/account-abstraction"
import { getEntryPointAddress } from "./entrypoint.ts"
import {
    mnemonicToAccount,
    privateKeyToAccount,
    generatePrivateKey
} from "viem/accounts"
import { foundry } from "viem/chains"

export const getAnvilWalletClient = ({
    addressIndex,
    anvilRpc
}: {
    addressIndex: number
    anvilRpc: string
}) => {
    return createWalletClient({
        account: mnemonicToAccount(
            "test test test test test test test test test test test junk",
            {
                addressIndex
            }
        ),
        chain: foundry,
        transport: http(anvilRpc)
    })
}

export const getPimlicoClient = ({
    entryPointVersion,
    altoRpc
}: {
    entryPointVersion: EntryPointVersion
    altoRpc: string
}) =>
    createPimlicoClient({
        chain: foundry,
        entryPoint: {
            address: getEntryPointAddress(entryPointVersion),
            version: entryPointVersion
        },
        transport: http(altoRpc)
    })

export const getPublicClient = (anvilRpc: string) => {
    const transport = http(anvilRpc)

    return createPublicClient({
        chain: foundry,
        transport: transport,
        pollingInterval: 100
    })
}

export const getSmartAccountClient = async ({
    entryPointVersion,
    anvilRpc,
    altoRpc,
    privateKey = generatePrivateKey()
}: AAParamType): Promise<
    SmartAccountClient<Transport, Chain, SmartAccount>
> => {
    const publicClient = getPublicClient(anvilRpc)

    const account = await toSimpleSmartAccount({
        client: publicClient,
        entryPoint: {
            address: getEntryPointAddress(entryPointVersion),
            version: entryPointVersion
        },
        owner: privateKeyToAccount(privateKey)
    })

    const anvilClient = createTestClient({
        transport: http(anvilRpc),
        chain: foundry,
        mode: "anvil"
    })

    await anvilClient.setBalance({
        address: account.address,
        value: parseEther("100")
    })

    return createSmartAccountClient({
        pollingInterval: 100,
        account,
        chain: foundry,
        bundlerTransport: http(altoRpc),
        userOperation: {
            estimateFeesPerGas: async () =>
                (
                    await getPimlicoClient({
                        entryPointVersion,
                        altoRpc
                    }).getUserOperationGasPrice()
                ).fast
        }
    })
}

export const setBundlingMode = async ({
    mode,
    altoRpc
}: {
    mode: "auto" | "manual"
    altoRpc: string
}) => {
    await fetch(altoRpc, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "debug_bundler_setBundlingMode",
            params: [mode],
            id: 4337
        })
    })
}

export const sendBundleNow = async ({ altoRpc }: { altoRpc: string }) => {
    await fetch(altoRpc, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "debug_bundler_sendBundleNow",
            params: [],
            id: 4337
        })
    })
}

export const clearBundlerState = async ({ altoRpc }: { altoRpc: string }) => {
    await fetch(altoRpc, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "debug_bundler_clearState",
            params: [],
            id: 4337
        })
    })
}

export const beforeEachCleanUp = async ({
    anvilRpc,
    altoRpc
}: {
    anvilRpc: string
    altoRpc: string
}) => {
    const anvilClient = createTestClient({
        transport: http(anvilRpc),
        chain: foundry,
        mode: "anvil"
    })

    await clearBundlerState({ altoRpc })
    await setBundlingMode({ mode: "auto", altoRpc })

    await anvilClient.setAutomine(true)
    await anvilClient.mine({ blocks: 1 })
}
