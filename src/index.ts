import { type ResultPromise, execa } from "execa"
import { type DefineInstanceReturnType, defineInstance } from "prool"

export type AltoParameters = {
    rpcUrl: string
    entrypoints: string[]
    executorPrivateKey: string
    host?: string
    port?: number
    path?: string
}

export function toFlagCase(key: string) {
    return `--${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`
}

export function toArgs(options: {
    [key: string]:
        | Record<string, string>
        | string
        | boolean
        | number
        | bigint
        | undefined
}) {
    return Object.entries(options).flatMap(([key, value]) => {
        if (value === undefined) {
            return []
        }

        if (typeof value === "object" && value !== null) {
            return Object.entries(value).flatMap(([subKey, subValue]) => {
                if (subValue === undefined) {
                    return []
                }
                const flag = toFlagCase(key)
                const value = `${subKey}: ${subValue}`
                return [flag, value]
            })
        }

        const flag = toFlagCase(key)

        if (value === false) {
            return []
        }
        if (value === true) {
            return [flag]
        }

        const stringified = value.toString()
        if (stringified === "") {
            return [flag]
        }

        return [flag, stringified]
    })
}

export const alto: DefineInstanceReturnType<
    { args: AltoParameters },
    AltoParameters
> = defineInstance((parameters: AltoParameters) => {
    const { path = "./alto", ...args } = parameters

    let process: ResultPromise<{ cleanup: true; reject: false }>

    async function stop() {
        const killed = process.kill()
        if (!killed) {
            throw new Error("Failed to stop anvil")
        }
        return new Promise((resolve) => process.on("close", resolve))
    }

    return {
        _internal: {
            args
        },
        host: args.host || "localhost",
        name: "alto",
        port: args.port ?? 4337,
        start: async ({ port = args.port }, { emitter }) => {
            return new Promise<void>((resolve, reject) => {
                const commandArgs = toArgs({
                    ...args,
                    port,
                    entrypoints: args.entrypoints.join(",")
                })

                process = execa(path, commandArgs, {
                    cleanup: true,
                    reject: false
                })

                process.stdout.on("data", (data) => {
                    const message = data.toString()
                    emitter.emit("message", message)
                    emitter.emit("stdout", message)
                    if (message.includes("Listening on")) {
                        emitter.emit("listening")
                        resolve()
                    }
                })
                process.stderr.on("data", async (data) => {
                    const message = data.toString()
                    emitter.emit("message", message)
                    emitter.emit("stderr", message)
                    await stop()
                    reject(
                        new Error(`Failed to start anvil: ${data.toString()}`)
                    )
                })
                process.on("close", () => process.removeAllListeners())
                process.on("exit", (code, signal) => {
                    emitter.emit("exit", code, signal)

                    if (!code) {
                        process.removeAllListeners()
                        reject(new Error("Failed to start anvil: exited."))
                    }
                })
            })
        },
        stop: async () => {
            process.removeAllListeners()
            await stop()
        }
    }
})
