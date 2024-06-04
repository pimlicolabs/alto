import type { Argv, Options } from "yargs"

export type CliCommandOptions<OwnArgs> = Required<{
    [key in keyof OwnArgs]: Options
}>

export interface CliCommand<
    OwnArgs = Record<never, never>,
    ParentArgs = Record<never, never>,
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    R = any
> {
    command: string
    describe: string
    examples?: { command: string; description: string }[]
    options?: CliCommandOptions<OwnArgs>
    // 1st arg: any = free own sub command options
    // 2nd arg: subcommand parent options is = to this command options + parent options
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    subcommands?: CliCommand<any, OwnArgs & ParentArgs>[]
    handler?: (args: OwnArgs & ParentArgs) => Promise<R>
}

/**
 * Register a CliCommand type to yargs. Recursively registers subcommands too.
 * @param yargs
 * @param cliCommand
 */
export function registerCommandToYargs(
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    yargs: Argv<any>,
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    cliCommand: CliCommand<any, any>
): void {
    yargs.command({
        command: cliCommand.command,
        describe: cliCommand.describe,
        builder: (yargsBuilder) => {
            yargsBuilder.options(cliCommand.options || {})
            for (const subcommand of cliCommand.subcommands || []) {
                registerCommandToYargs(yargsBuilder, subcommand)
            }
            if (cliCommand.examples) {
                for (const example of cliCommand.examples) {
                    yargsBuilder.example(
                        `$0 ${example.command}`,
                        example.description
                    )
                }
            }
            return yargs
        },
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        handler: cliCommand.handler || function emptyHandler(): void {}
    })
}
