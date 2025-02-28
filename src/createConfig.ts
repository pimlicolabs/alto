import type { IOptions } from "@alto/cli"
import type { CamelCasedProperties } from "./cli/parseArgs"
import type { Bindings, ChildLoggerOptions, Logger } from "pino"
import type { Chain, PublicClient, Transport, WalletClient } from "viem"

export type AltoConfig = Readonly<CamelCasedProperties<IOptions>> & {
    getLogger: <ChildCustomLevels extends string = never>(
        bindings: Bindings,
        options?: ChildLoggerOptions<ChildCustomLevels>
    ) => Logger<ChildCustomLevels>
    readonly publicClient: PublicClient<Transport, Chain>
    readonly walletClient: WalletClient<Transport, Chain>
    readonly chainId: number
}

export function createConfig(
    config: CamelCasedProperties<IOptions> & {
        logger: Logger
        publicClient: PublicClient<Transport, Chain>
        walletClient: WalletClient<Transport, Chain>
    }
): AltoConfig {
    const { logger, ...rest } = config

    return {
        ...rest,
        chainId: config.publicClient.chain.id,
        getLogger: (bindings, options) => logger.child(bindings, options)
    }
}
