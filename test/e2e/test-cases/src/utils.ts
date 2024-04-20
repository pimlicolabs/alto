import { getEntryPointVersion, SmartAccountClient, createSmartAccountClient } from "permissionless"
import { createPimlicoBundlerClient, type PimlicoBundlerClient } from "permissionless/clients/pimlico"
import { EntryPoint } from "permissionless/types/entrypoint"
import {
    http,
    createWalletClient,
    createPublicClient,
    Hex,
    Transport,
    Chain,
} from "viem"
import {
    type Address,
    generatePrivateKey,
    privateKeyToAddress,
    mnemonicToAccount
} from "viem/accounts"
import { foundry } from "viem/chains"
import { SIMPLE_ACCOUNT_FACTORY_V06_ADDRESS, SIMPLE_ACCOUNT_FACTORY_V07_ADDRESS } from "./constants"
import { privateKeyToSimpleSmartAccount, SmartAccount } from "permissionless/accounts"

export const newRandomAddress = (): Address => {
    return privateKeyToAddress(generatePrivateKey())
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
        transport: http(process.env.ANVIL_RPC)
    })
}

export const getPimlicoBundlerClient = <T extends EntryPoint>(
    entryPoint: T
): PimlicoBundlerClient<T> =>
    createPimlicoBundlerClient({
        chain: foundry,
        entryPoint,
        transport: http(process.env.ALTO_RPC)
    })

export const getPublicClient = () => {
    return createPublicClient({
        chain: foundry,
        transport: http(process.env.ANVIL_RPC)
    })
}

const publicClient = getPublicClient()

export const setupSimpleSmartAccountClient = async <T extends EntryPoint>({
    entryPoint,
    privateKey = generatePrivateKey(),
    pimlicoBundlerClient
}: {
    entryPoint: T
    privateKey?: Hex
    pimlicoBundlerClient?: PimlicoBundlerClient<T>
}): Promise<SmartAccountClient<T, Transport, Chain, SmartAccount<T>>> => {
    const smartAccount = await privateKeyToSimpleSmartAccount<
        T,
        Transport,
        Chain
    >(publicClient, {
        entryPoint,
        privateKey,
        factoryAddress: getEntryPointVersion(entryPoint) === "v0.6"
            ? SIMPLE_ACCOUNT_FACTORY_V06_ADDRESS
            : SIMPLE_ACCOUNT_FACTORY_V07_ADDRESS

    })

    return createSmartAccountClient({
        chain: foundry,
        account: smartAccount,
        bundlerTransport: http(process.env.ALTO_RPC),
        middleware: {
            gasPrice: pimlicoBundlerClient
                ? async () => {
                    return (
                        await pimlicoBundlerClient.getUserOperationGasPrice()
                    ).fast
                }
                : undefined,
        }
    })
}
