import { bundlerCommand, bundlerOptions } from "./config/options"
import { registerCommandToYargs } from "./util"
import dotenv from "dotenv"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import * as sentry from "@sentry/node"
import { ProfilingIntegration } from "@sentry/profiling-node"

// Load environment variables from .env file
dotenv.config()

if (process.env.SENTRY_DSN) {
    sentry.init({
        dsn: process.env.SENTRY_DSN,
        integrations: [new ProfilingIntegration()],
        // Performance Monitoring
        tracesSampleRate: 1.0,
        // Set sampling rate for profiling - this is relative to tracesSampleRate
        profilesSampleRate: 1.0
    })
}

export const yarg = yargs((hideBin as (args: string[]) => string[])(process.argv))

const topBanner = `🏔️ Alto: TypeScript ERC-4337 Bundler.
  * by Pimlico, 2023`
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
        err !== undefined ? (err instanceof YargsError ? err.message : err.stack) : msg || "Unknown error"

    // eslint-disable-next-line no-console
    console.error(` ✖ ${errorMessage}\n`)
    process.exit(1)
}).parse()
