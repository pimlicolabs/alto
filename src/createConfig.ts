import type { IOptions } from "@alto/cli"
import type { CamelCasedProperties } from "./cli/parseArgs"
import type { Logger } from "pino"
import type { Chain, PublicClient, Transport, WalletClient } from "viem"

export type AltoConfig = {
    args: CamelCasedProperties<IOptions>
    logger: Logger
    publicClient: PublicClient<Transport, Chain>
    walletClient: WalletClient<Transport, Chain>
}

export function createConfig(config: {
    args: CamelCasedProperties<IOptions>
    logger: Logger
    publicClient: PublicClient<Transport, Chain>
    walletClient: WalletClient<Transport, Chain>
}): AltoConfig {
    return {
        ...config
    }
}
