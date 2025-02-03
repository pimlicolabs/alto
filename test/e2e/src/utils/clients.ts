import { toSimpleSmartAccount } from "permissionless/accounts"
import { createSmartAccountClient } from "permissionless/clients"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import { http, type Hex, createPublicClient } from "viem"
import {
    entryPoint06Address,
    entryPoint07Address
} from "viem/account-abstraction"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { base } from "viem/chains"

export async function createClients({
    anvilRpc,
    altoRpc,
    paymasterRpc,
    ownerPrivateKey,
    entryPointVersion = "0.7"
}: {
    anvilRpc: string
    altoRpc: string
    paymasterRpc: string
    ownerPrivateKey?: Hex
    entryPointVersion?: "0.6" | "0.7"
}) {
    const owner = privateKeyToAccount(ownerPrivateKey ?? generatePrivateKey())

    const publicClient = createPublicClient({
        chain: base,
        transport: http(anvilRpc)
    })

    const account = await toSimpleSmartAccount({
        owner,
        client: publicClient,
        entryPoint: {
            address:
                entryPointVersion === "0.6"
                    ? entryPoint06Address
                    : entryPoint07Address,
            version: entryPointVersion
        }
    })

    const paymasterClient = createPimlicoClient({
        chain: base,
        transport: http(paymasterRpc),
        entryPoint: {
            address:
                entryPointVersion === "0.6"
                    ? entryPoint06Address
                    : entryPoint07Address,
            version: entryPointVersion
        }
    })

    const smartAccountClient = createSmartAccountClient({
        client: publicClient,
        account,
        paymaster: paymasterClient,
        bundlerTransport: http(altoRpc),
        userOperation: {
            estimateFeesPerGas: async () => {
                return (await paymasterClient.getUserOperationGasPrice()).fast
            }
        }
    })

    return {
        publicClient,
        smartAccountClient
    }
}
