import { resolve } from "node:path"
import { defineInstance } from "prool"
import { type Hex, toHex } from "viem"
import { mnemonicToAccount } from "viem/accounts"
import altoConfig from "../../alto-config.json" with { type: "json" }
import { execa } from "./execa.js"

export const alto = defineInstance(
    (args: {
        anvilRpc: string
        port: number
        extraConfig?: Record<string, unknown>
    }) => {
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
                //     resolve(__dirname, "../../../../src/cli/alto.ts"),
                //     "run"
                // ]

                const binary = [
                    "tsx",
                    "--tsconfig",
                    `${process.cwd()}/../../src/tsconfig.json`,
                    resolve(__dirname, "../../../../src/cli/alto.ts"),
                    "run"
                ]

                const envConfig = Object.fromEntries(
                    Object.entries({
                        ...altoConfig,
                        ...args.extraConfig
                    }).map(([key, value]) => [
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
                                ALTO_PORT: port.toString(),
                                TSX_TSCONFIG_PATH: `${process.cwd()}/../../src/tsconfig.json`
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

const getAnvilPrivateKey = (addressIndex: number): Hex => {
    const { privateKey } = mnemonicToAccount(
        "test test test test test test test test test test test junk",
        { addressIndex }
    ).getHdKey()
    if (!privateKey) {
        throw new Error(`No private key for anvil account ${addressIndex}`)
    }
    return toHex(privateKey)
}

// Starts an extra alto instance against the shared anvil with extra flags
export const startAltoWithFlags = async ({
    anvilRpc,
    port,
    flags
}: {
    anvilRpc: string
    port: number
    flags: Record<string, unknown>
}): Promise<{ altoRpc: string; stop: () => Promise<void> }> => {
    const instance = alto({
        anvilRpc,
        port,
        extraConfig: {
            // Anvil accounts 13-17 (the global instance in alto-config.json
            // uses 0-12), so a second instance never races the global one for
            // executor nonces
            "utility-private-key": getAnvilPrivateKey(13),
            "v6-executor-private-keys": getAnvilPrivateKey(14),
            "v7-executor-private-keys": getAnvilPrivateKey(15),
            "v8-executor-private-keys": getAnvilPrivateKey(16),
            "v9-executor-private-keys": getAnvilPrivateKey(17),
            "bundling-mode": "auto",
            ...flags
        }
    })
    await instance.start()

    return {
        altoRpc: `http://${instance.host}:${instance.port}`,
        stop: () => instance.stop()
    }
}
