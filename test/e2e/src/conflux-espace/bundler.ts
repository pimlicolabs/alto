import { resolve } from "node:path"
import { execa, type ExecaChildProcess } from "execa"
import type { Address } from "viem"
import type { ConfluxEspaceDemoEnv } from "./env.js"

type BundlerProcess = {
    altoRpc: string
    process: ExecaChildProcess
    stop: () => Promise<void>
}

export const startConfluxEspaceBundler = async ({
    env,
    entryPoint
}: {
    env: ConfluxEspaceDemoEnv
    entryPoint: Address
}): Promise<BundlerProcess> => {
    const repoRoot = resolve(__dirname, "../../../..")
    const tsconfigPath = resolve(repoRoot, "src/tsconfig.json")
    const altoEntry = resolve(repoRoot, "src/cli/alto.ts")
    const altoRpc = `http://127.0.0.1:${env.port}`

    const child = execa(
        process.execPath,
        ["--import", "tsx/esm", altoEntry, "run"],
        {
            cwd: repoRoot,
            env: {
                ...process.env,
                ALTO_ENTRYPOINTS: entryPoint,
                ALTO_RPC_URL: env.rpcUrl,
                ALTO_SEND_TRANSACTION_RPC_URL: env.sendTransactionRpcUrl ?? "",
                ALTO_UTILITY_PRIVATE_KEY: env.bundlerPrivateKey,
                ALTO_EXECUTOR_PRIVATE_KEYS: env.executorPrivateKeys,
                ALTO_REFILLING_WALLETS: "false",
                ALTO_MIN_EXECUTOR_BALANCE: "0",
                ALTO_PORT: env.port.toString(),
                ALTO_BLOCK_TIME: env.blockTimeMs.toString(),
                ALTO_LOG_LEVEL: env.logLevel,
                ALTO_PUBLIC_CLIENT_LOG_LEVEL: env.logLevel,
                ALTO_WALLET_CLIENT_LOG_LEVEL: env.logLevel,
                ALTO_ENABLE_DEBUG_ENDPOINTS: "true",
                ALTO_ENABLE_INSTANT_BUNDLING_ENDPOINT: "true",
                ALTO_DEPLOY_SIMULATIONS_CONTRACT: "true",
                ALTO_BUNDLE_MODE: "auto",
                ALTO_SAFE_MODE: String(env.safeMode),
                ALTO_BALANCE_OVERRIDE: String(env.balanceOverride),
                ALTO_CODE_OVERRIDE_SUPPORT: String(env.codeOverrideSupport),
                ALTO_CHAIN_TYPE: "default",
                ALTO_CHAIN_NATIVE_DECIMALS: "18",
                ALTO_MIN_ENTITY_STAKE: "1",
                ALTO_MIN_ENTITY_UNSTAKE_DELAY: "1",
                TSX_TSCONFIG_PATH: tsconfigPath
            },
            reject: false
        }
    )

    const started = new Promise<void>((resolvePromise, rejectPromise) => {
        const timeout = setTimeout(() => {
            rejectPromise(new Error("Timed out waiting for bundler startup"))
        }, 180_000)

        const onStdout = (data: Buffer | string) => {
            const message = data.toString()
            if (message.includes("Server listening at")) {
                clearTimeout(timeout)
                resolvePromise()
            }
        }

        const onExit = () => {
            clearTimeout(timeout)
            rejectPromise(new Error("Bundler exited before becoming ready"))
        }

        child.stdout?.on("data", onStdout)
        child.stderr?.on("data", () => {})
        child.once("exit", onExit)
    })

    await started

    return {
        altoRpc,
        process: child,
        stop: async () => {
            child.kill()
            await child
        }
    }
}
