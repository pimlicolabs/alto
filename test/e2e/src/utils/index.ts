import {
    type SmartAccountClient,
    createSmartAccountClient
} from "permissionless"
import { toSimpleSmartAccount } from "permissionless/accounts"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import {
    http,
    type Chain,
    type Hex,
    type Transport,
    createPublicClient,
    createTestClient,
    createWalletClient,
    parseEther
} from "viem"
import {
    type EntryPointVersion,
    type SmartAccount,
    toSimple7702SmartAccount
} from "viem/account-abstraction"
import {
    generatePrivateKey,
    mnemonicToAccount,
    privateKeyToAccount,
    privateKeyToAddress
} from "viem/accounts"
import { foundry } from "viem/chains"
import { getEntryPointAddress } from "./entrypoint.ts"

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

export type AAParamType = {
    entryPointVersion: EntryPointVersion
    anvilRpc: string
    altoRpc: string
    use7702?: boolean
    fundAccount?: boolean
    privateKey?: Hex
}

export const getSmartAccountClient = async ({
    entryPointVersion,
    anvilRpc,
    altoRpc,
    use7702 = false,
    fundAccount = true,
    privateKey = generatePrivateKey()
}: AAParamType): Promise<
    SmartAccountClient<Transport, Chain, SmartAccount>
> => {
    const publicClient = getPublicClient(anvilRpc)

    let account: SmartAccount

    if (use7702 && entryPointVersion === "0.8") {
        account = await toSimple7702SmartAccount({
            owner: privateKeyToAccount(privateKey),
            client: publicClient
        })
    } else if (use7702) {
        account = await toSimpleSmartAccount({
            client: publicClient,
            entryPoint: {
                address: getEntryPointAddress(entryPointVersion),
                version: entryPointVersion
            },
            owner: privateKeyToAccount(privateKey)
        })

        account.address = privateKeyToAddress(privateKey)
        account.getFactoryArgs = async () => ({
            factory: undefined,
            factoryData: undefined
        })
    } else {
        account = await toSimpleSmartAccount({
            client: publicClient,
            entryPoint: {
                address: getEntryPointAddress(entryPointVersion),
                version: entryPointVersion
            },
            owner: privateKeyToAccount(privateKey)
        })
    }

    if (fundAccount) {
        const anvilClient = createTestClient({
            transport: http(anvilRpc),
            chain: foundry,
            mode: "anvil"
        })

        await anvilClient.setBalance({
            address: account.address,
            value: parseEther("100")
        })
    }

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

export const getSimple7702AccountImplementationAddress = (
    entryPointVersion: EntryPointVersion
) => {
    switch (entryPointVersion) {
        case "0.8":
            return "0xe6Cae83BdE06E4c305530e199D7217f42808555B"
        case "0.7":
            return "0xf3F57446bEC27F6531EFF3Da2B917ebA8F9BA49c"
        case "0.6":
            return "0x90c7Fc0Fe4F0188E61C131d5dB7aCa03a684a2fB"
        default:
            throw new Error("Unknown EntryPointVersion")
    }
}
