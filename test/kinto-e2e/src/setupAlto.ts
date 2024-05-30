import { spawn } from "node:child_process"
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"
import { type Hex, createTestClient, http, parseEther } from "viem"
import waitPort from "wait-port"
import { sleep } from "./utils"

// skip docker wait times, just start locally
export const startAlto = async (rpc: string, altoPort: string) => {
    const anvil = createTestClient({
        transport: http(rpc),
        mode: "anvil"
    })

    const pks = Array.from({ length: 6 }, () => generatePrivateKey())
    for (const pk of pks) {
        await anvil.setBalance({
            address: privateKeyToAddress(pk),
            value: parseEther("100")
        })
    }

    const utilitKey = pks.pop() as Hex
    const executorKeys = pks.join(",")

    const command = "pnpm"
    const args = [
        "run",
        "start",
        "run",
        "--config",
        "./test/kinto-e2e/kinto-alto-config.json",
        "--rpc-url",
        rpc,
        "--utility-private-key",
        utilitKey,
        "--executor-private-keys",
        executorKeys,
        "--port",
        altoPort
    ]
    const options = {
        cwd: "../../",
        env: { ...process.env, COREPACK_ENABLE_STRICT: "0" },
        detached: true
    }

    const alto = spawn(command, args, options)

    // [USE FOR DEBUGGING]
    // alto.stdout.on("data", (data) => console.log(data.toString()))
    // alto.stderr.on("data", (data) => console.log(data.toString()))

    await waitPort({
        host: "127.0.0.1",
        port: Number.parseInt(altoPort),
        output: "silent"
    })

    let timeoutCounter = 0

    for (; timeoutCounter < 10; timeoutCounter++) {
        await sleep(500)

        const isHealthy = await fetch(`http://127.0.0.1:${altoPort}/health`)
            .then((res) => res.ok)
            .catch(() => false)

        if (isHealthy) {
            break
        }
    }

    if (timeoutCounter === 10) {
        // biome-ignore lint/suspicious/noConsoleLog:
        console.log("Timed out whilst waiting for alto to startup")
        process.exit(1)
    }

    await sleep(250)

    return alto
}
