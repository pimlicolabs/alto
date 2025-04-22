import { anvil } from "prool/instances"
import { resolve } from "node:path"
import { foundry } from "viem/chains"
import { setupContracts } from "./deploy-contracts/index.js"
import { defineInstance } from "prool"
import { execa } from "./src/utils/execa.js"
import altoConfig from "./alto-config.json"

export const ENTRY_POINT_SIMULATIONS_ADDRESS =
    "0x74Cb5e4eE81b86e70f9045036a1C5477de69eE87"

export const alto = defineInstance(
    (args: { anvilRpc: string; port: number }) => {
        const name = "alto"
        const execaProcess = execa({ name })

        return {
            _internal: {
                args,
                get process() {
                    return execaProcess._internal.process
                }
            },
            host: "localhost",
            name,
            port: args.port ?? 8080,
            async start({ port = args.port ?? 8080 }, options) {
                // const binary = [
                //     "nodemon",
                //     "--ext",
                //     "ts,js,json",
                //     "--watch",
                //     "src",
                //     "--exec",
                //     `DOTENV_CONFIG_PATH=${process.cwd()}/../../.env`,
                //     "ts-node",
                //     "--project",
                //     `${process.cwd()}/../../src/tsconfig.json`,
                //     "-r",
                //     "tsconfig-paths/register",
                //     resolve(__dirname, "../../src/cli/alto.ts"),
                //     "run"
                // ]

                const binary = [
                    "ts-node",
                    "--project",
                    `${process.cwd()}/../../src/tsconfig.json`,
                    "-r",
                    "tsconfig-paths/register",
                    resolve(__dirname, "../../src/cli/alto.ts"),
                    "run"
                ]

                const envConfig = Object.fromEntries(
                    Object.entries(altoConfig).map(([key, value]) => [
                        `ALTO_${key.toUpperCase().replace(/-/g, "_")}`,
                        value
                    ])
                )

                await execaProcess.start(
                    ($) =>
                        $({
                            env: {
                                ...envConfig,
                                ALTO_RPC_URL: args.anvilRpc,
                                ALTO_PORT: port.toString()
                            }
                        })`${binary}`,
                    {
                        ...options,
                        // Resolve when the process is listening via a "Server listening at" message.
                        resolver({ process, reject, resolve }) {
                            process.stdout.on("data", (data) => {
                                const message = data.toString()
                                // console.log("Alto stdout data", message)
                                if (message.includes("Server listening at")) {
                                    resolve()
                                }
                            })
                            // process.stdout.on("error", (error) => {
                            //     console.error("Alto stdout error", error)
                            // })
                            // process.stderr.on("data", (data) => {
                            //     console.error(
                            //         "Alto stderr data",
                            //         data.toString()
                            //     )
                            // })
                            // process.stderr.on("error", (error) => {
                            //     console.error("Alto stderr error", error)
                            // })
                            process.stderr.on("end", () => {
                                // console.log("Alto stderr ended")
                                reject("stderr ended")
                            })
                            process.on("error", (error) => {
                                reject(error.message)
                            })
                        }
                    }
                )
            },
            async stop() {
                await execaProcess.stop()
            }
        }
    }
)

// biome-ignore lint/style/noDefaultExport: vitest needs this
export default async function setup({ provide }) {
    const anvilInstance = anvil({
        chainId: foundry.id,
        port: 8545,
        codeSizeLimit: 1000_000,
        gasLimit: 30_000_000
    })
    await anvilInstance.start()
    const anvilRpc = `http://${anvilInstance.host}:${anvilInstance.port}`

    await setupContracts({ anvilRpc })

    const altoInstance = alto({
        port: 8080,
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
