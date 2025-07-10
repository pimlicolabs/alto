import type { EventEmitter } from "eventemitter3"
import { type ResultPromise, execa as exec } from "execa"
import type { Instance } from "prool"

export type Process_internal = ResultPromise<{ cleanup: true; reject: false }>

type EventTypes = {
    exit: [code: number | null, signal: NodeJS.Signals | null]
    listening: []
    message: [message: string]
    stderr: [message: string]
    stdout: [message: string]
}

export type ExecaStartOptions = {
    emitter: EventEmitter<EventTypes>
    status: Instance["status"]
    resolver(options: {
        process: Process_internal
        reject(data: string): Promise<void>
        resolve(): void
    }): void
}

export type ExecaParameters = { name: string }

export type ExecaProcess = {
    _internal: {
        process: Process_internal
    }
    name: string
    start(
        command: (x: typeof exec) => void,
        options: ExecaStartOptions
    ): Promise<void>
    stop(): Promise<void>
}
export type ExecaReturnType = ExecaProcess

export function execa(parameters: ExecaParameters): ExecaReturnType {
    const { name } = parameters

    const errorMessages: string[] = []
    let process: Process_internal

    async function stop() {
        const killed = process.kill()
        if (!killed) {
            return
        }
        return new Promise((resolve) => process.on("close", resolve))
    }

    return {
        _internal: {
            get process() {
                return process
            }
        },
        name,
        start(command, { emitter, resolver, status }) {
            const { promise, resolve, reject } = Promise.withResolvers<void>()

            process = command(
                exec({
                    cleanup: true,
                    reject: false
                }) as any
            ) as unknown as Process_internal

            resolver({
                process,
                async reject(data) {
                    await stop()
                    reject(
                        new Error(
                            `Failed to start process "${name}": ${data.toString()}`
                        )
                    )
                },
                resolve() {
                    emitter.emit("listening")
                    return resolve()
                }
            })

            process.stdout.on("data", (data) => {
                const message = data.toString()
                emitter.emit("message", message)
                emitter.emit("stdout", message)
            })
            process.stderr.on("data", (data) => {
                const message = data.toString()
                errorMessages.push(message)
                if (errorMessages.length > 20) {
                    errorMessages.shift()
                }

                emitter.emit("message", message)
                emitter.emit("stderr", message)
            })
            process.on("close", () => process.removeAllListeners())
            process.on("exit", (code, signal) => {
                emitter.emit("exit", code, signal)

                if (!code) {
                    process.removeAllListeners()
                    if (status === "starting") {
                        reject(
                            new Error(
                                `Failed to start process "${name}": ${
                                    errorMessages.length > 0
                                        ? `\n\n${errorMessages.join("\n")}`
                                        : "exited"
                                }`
                            )
                        )
                    }
                }
            })

            return promise
        },
        async stop() {
            process.removeAllListeners()
            await stop()
        }
    }
}
