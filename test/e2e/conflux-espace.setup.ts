import { join } from "node:path"
import { config as loadDotEnv } from "dotenv"
import {
    createConfluxEspaceClients,
    ensureConfluxEspaceV08CoreContracts
} from "./src/conflux-espace/contracts.js"
import { getConfluxEspaceChain } from "./src/conflux-espace/chain.js"
import { startConfluxEspaceBundler } from "./src/conflux-espace/bundler.js"
import { getConfluxEspaceDemoEnv } from "./src/conflux-espace/env.js"

// biome-ignore lint/style/noDefaultExport: vitest globalSetup requires default
export default async function setup({ provide }) {
    loadDotEnv({
        path: join(__dirname, ".env.conflux-espace-testnet")
    })

    const env = getConfluxEspaceDemoEnv()
    const chain = await getConfluxEspaceChain({
        rpcUrl: env.rpcUrl
    })

    const { publicClient, walletClient } = createConfluxEspaceClients({
        chain,
        rpcUrl: env.rpcUrl,
        privateKey: env.bundlerPrivateKey
    })

    const deployed = await ensureConfluxEspaceV08CoreContracts({
        publicClient,
        walletClient
    })

    const bundler = await startConfluxEspaceBundler({
        env,
        entryPoint: deployed.entryPoint
    })

    provide("confluxEspaceRpc", env.rpcUrl)
    provide("confluxEspaceAltoRpc", bundler.altoRpc)
    provide("confluxEspaceChainId", chain.id)
    provide("confluxEspaceEntryPointV08", deployed.entryPoint)
    provide(
        "confluxEspaceSimpleAccountFactoryV08",
        deployed.simpleAccountFactory
    )
    provide("confluxEspaceOwnerPrivateKey", env.ownerPrivateKey)
    provide("confluxEspaceBundlerPrivateKey", env.bundlerPrivateKey)

    return async () => {
        await bundler.stop()
    }
}

declare module "vitest" {
    export interface ProvidedContext {
        confluxEspaceRpc: string
        confluxEspaceAltoRpc: string
        confluxEspaceChainId: number
        confluxEspaceEntryPointV08: `0x${string}`
        confluxEspaceSimpleAccountFactoryV08: `0x${string}`
        confluxEspaceOwnerPrivateKey: `0x${string}`
        confluxEspaceBundlerPrivateKey: `0x${string}`
    }
}
