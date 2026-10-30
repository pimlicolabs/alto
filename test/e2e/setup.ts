import { anvil } from "prool/instances"
import { foundry } from "viem/chains"
import { setupContracts } from "./deploy-contracts/index.js"
import { alto } from "./src/utils/altoInstance.js"

// biome-ignore lint/style/noDefaultExport: vitest needs this
export default async function setup({ provide }) {
    // prool treats anything on anvil's stderr as a startup failure
    process.env.FOUNDRY_DISABLE_NIGHTLY_WARNING = "1"

    const anvilInstance = anvil({
        chainId: foundry.id,
        port: 8545,
        hardfork: "Prague",
        // Executor and utility keys are default anvil mnemonic accounts:
        // 0-5 for alto-config.json, 6-10 for startAltoWithFlags
        accounts: 11,
        codeSizeLimit: 1000_000,
        gasLimit: 30_000_000
    })
    await anvilInstance.start()
    const anvilRpc = `http://${anvilInstance.host}:${anvilInstance.port}`

    await setupContracts({ anvilRpc })

    const altoInstance = alto({
        port: Number(process.env.ALTO_E2E_PORT ?? 8080),
        anvilRpc
    })
    await altoInstance.start()

    // altoInstance.on("stdout", (data) => {
    //     console.log("Alto stdout", data.toString())
    // })
    // altoInstance.on("stderr", (data) => {
    //     console.error("Alto stderr", data.toString())
    // })
    const altoRpc = `http://${altoInstance.host}:${altoInstance.port}`

    provide("anvilRpc", anvilRpc)
    provide("altoRpc", altoRpc)

    return async () => {
        await altoInstance.stop()
        await anvilInstance.stop()
    }
}

declare module "vitest" {
    export interface ProvidedContext {
        anvilRpc: string
        altoRpc: string
    }
}
