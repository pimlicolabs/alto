#!/usr/bin/env node
import * as sentry from "@sentry/node"
import dotenv from "dotenv"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import {
    bundlerCommand,
    bundlerOptions,
    compatibilityOptions,
    debugOptions,
    executorOptions,
    gasEstimationOptions,
    logOptions,
    mempoolOptions,
    rpcOptions,
    serverOptions
} from "./config"
import { registerCommandToYargs } from "./util"
import { TimeoutError, HttpRequestError, InternalRpcError } from "viem"

// Load environment variables from .env file
if (process.env.DOTENV_CONFIG_PATH) {
    dotenv.config({ path: process.env.DOTENV_CONFIG_PATH })
} else {
    dotenv.config()
}

if (process.env.SENTRY_DSN) {
    const SENTRY_IGNORE_ERRORS = [
        InternalRpcError,
        HttpRequestError,
        TimeoutError
    ]

    sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.ENVIRONMENT,
        tracesSampleRate: 0,
        profilesSampleRate: 0,
        beforeSend(event, hint) {
            const errorType = event.exception?.values?.[0]?.type

            const shouldIgnore = SENTRY_IGNORE_ERRORS.some(
                (error) =>
                    hint.originalException instanceof error ||
                    errorType === error.name
            )

            if (shouldIgnore) {
                return null
            }

            return event
        }
    })
}

export const yarg = yargs(
    (hideBin as (args: string[]) => string[])(process.argv)
)

const topBanner = `🏔 Alto: TypeScript ERC-4337 Bundler.
  * by Pimlico, 2024`
const bottomBanner = `📖 For more information, check the our docs:
  * https://docs.pimlico.io/
`

export function getAltoCli(): yargs.Argv {
    const alto = yarg
        .wrap(null)
        .env("ALTO")
        .parserConfiguration({
            // As of yargs v16.1.0 dot-notation breaks strictOptions()
            // Manually processing options is typesafe tho more verbose
            "dot-notation": true
        })
        .options(bundlerOptions)
        .group(Object.keys(bundlerOptions), "Options:")
        .options(compatibilityOptions)
        .group(Object.keys(compatibilityOptions), "Compatibility Options:")
        .options(serverOptions)
        .group(Object.keys(serverOptions), "Server Options:")
        .options(executorOptions)
        .group(Object.keys(executorOptions), "Executor Options:")
        .options(rpcOptions)
        .group(Object.keys(rpcOptions), "RPC Options:")
        .options(logOptions)
        .group(Object.keys(logOptions), "Logging Options:")
        .options(debugOptions)
        .group(Object.keys(debugOptions), "Debug Options:")
        .options(gasEstimationOptions)
        .group(Object.keys(gasEstimationOptions), "Gas Estimation Options:")
        .options(mempoolOptions)
        .group(Object.keys(mempoolOptions), "Mempool Options:")
        // blank scriptName so that help text doesn't display the cli name before each command
        .scriptName("")
        .demandCommand(1)
        .usage(topBanner)
        .epilogue(bottomBanner)
        // Control show help behaviour below on .fail()
        .showHelpOnFail(false)
        .alias("h", "help")
        .alias("v", "version")
        .recommendCommands()

    // throw an error if we see an unrecognized cmd
    alto.recommendCommands() //.strict()
    alto.config()

    // yargs.command and all ./cmds
    registerCommandToYargs(alto, bundlerCommand)

    return alto
}

export class YargsError extends Error {}

const alto = getAltoCli()

// eslint-disable-next-line @typescript-eslint/no-floating-promises
alto.fail((msg, err) => {
    if (msg) {
        // Show command help message when no command is provided
        if (msg.includes("Not enough non-option arguments")) {
            yarg.showHelp()
            // eslint-disable-next-line no-console
            console.log("\n")
        }
    }

    const errorMessage =
        err !== undefined
            ? err instanceof YargsError
                ? err.message
                : err.stack
            : msg || "Unknown error"

    // eslint-disable-next-line no-console
    console.error(` × ${errorMessage}\n`)
    process.exit(1)
}).parse()
