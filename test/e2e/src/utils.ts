import {
    Chain,
    Hex,
    Transport,
    createPublicClient,
    createTestClient,
    createWalletClient,
    http,
    parseEther,
    parseGwei
} from "viem"
import {
    generatePrivateKey,
    mnemonicToAccount,
    privateKeyToAccount
} from "viem/accounts"
import {
    ALTO_RPC,
    ANVIL_RPC,
    SIMPLE_ACCOUNT_FACTORY_V06,
    SIMPLE_ACCOUNT_FACTORY_V07
} from "./constants"
import { foundry } from "viem/chains"
import { EntryPoint } from "permissionless/types"
import {
    PimlicoBundlerClient,
    PimlicoPaymasterClient,
    createPimlicoBundlerClient
} from "permissionless/clients/pimlico"
import {
    createSmartAccountClient,
    SmartAccountClient,
    getEntryPointVersion,
    BundlerClient,
    createBundlerClient
} from "permissionless"
import {
    SmartAccount,
    signerToSimpleSmartAccount
} from "permissionless/accounts"

const publicClient = createPublicClient({
    transport: http(ANVIL_RPC),
    chain: foundry
})

const anvilClient = createTestClient({
    transport: http(ANVIL_RPC),
    chain: foundry,
    mode: "anvil"
})

export type AAParamType<T extends EntryPoint> = {
    entryPoint: T
    paymasterClient?: PimlicoPaymasterClient<T>
    privateKey?: Hex
}

export const getFactoryAddress = (
    entryPoint: EntryPoint,
    accountType: "simple" | "safe"
) => {
    switch (accountType) {
        case "simple":
            return getEntryPointVersion(entryPoint) === "v0.6"
                ? SIMPLE_ACCOUNT_FACTORY_V06
                : SIMPLE_ACCOUNT_FACTORY_V07
        case "safe":
            break
    }

    throw new Error("Parameters not recongized")
}

export const getAnvilWalletClient = (addressIndex: number) => {
    return createWalletClient({
        account: mnemonicToAccount(
            "test test test test test test test test test test test junk",
            {
                addressIndex
            }
        ),
        chain: foundry,
        transport: http(ANVIL_RPC)
    })
}

export const getBundlerClient = <T extends EntryPoint>(
    entryPoint: T
): BundlerClient<T, Chain> =>
    createBundlerClient({
        chain: foundry,
        entryPoint,
        transport: http(ALTO_RPC)
    }) as BundlerClient<T, Chain>

export const getPimlicoBundlerClient = <T extends EntryPoint>(
    entryPoint: T
): PimlicoBundlerClient<T> =>
    createPimlicoBundlerClient({
        chain: foundry,
        entryPoint,
        transport: http(ALTO_RPC)
    })

export const getSmartAccountClient = async <T extends EntryPoint>({
    entryPoint,
    privateKey = generatePrivateKey()
}: AAParamType<T>): Promise<
    SmartAccountClient<T, Transport, Chain, SmartAccount<T>>
> => {
    const smartAccount = await signerToSimpleSmartAccount<T, Transport, Chain>(
        publicClient,
        {
            entryPoint,
            signer: privateKeyToAccount(privateKey),
            factoryAddress: getFactoryAddress(entryPoint, "simple")
        }
    )

    await anvilClient.setBalance({
        address: smartAccount.address,
        value: parseEther("100")
    })

    // @ts-ignore
    return createSmartAccountClient({
        chain: foundry,
        account: smartAccount,
        bundlerTransport: http(ALTO_RPC)
    })
}

export const setBundlingMode = async (mode: "auto" | "manual") => {
    await fetch(ALTO_RPC, {
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

export const sendBundleNow = async () => {
    await fetch(ALTO_RPC, {
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

export const clearBundlerState = async () => {
    await fetch(ALTO_RPC, {
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

export const beforeEachCleanUp = async () => {
    await clearBundlerState()
    await setBundlingMode("auto")

    await anvilClient.setAutomine(true)
    await anvilClient.mine({ blocks: 1 })
}
