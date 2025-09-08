import type { IOptions } from "@alto/cli"
import type { Bindings, ChildLoggerOptions, Logger } from "pino"
import type {
    Address,
    Chain,
    PublicClient,
    Transport,
    WalletClient
} from "viem"
import type { CamelCasedProperties } from "./cli/parseArgs"

export type AltoConfig = Readonly<CamelCasedProperties<IOptions>> & {
    getLogger: <ChildCustomLevels extends string = never>(
        bindings: Bindings,
        options?: ChildLoggerOptions<ChildCustomLevels>
    ) => Logger<ChildCustomLevels>
    readonly publicClient: PublicClient<Transport, Chain>
    readonly walletClients: {
        readonly private?: WalletClient<Transport, Chain>
        readonly public: WalletClient<Transport, Chain>
    }
    readonly chainId: number
    readonly utilityWalletAddress: Address
}

export function createConfig(
    config: CamelCasedProperties<IOptions> & {
        logger: Logger
        publicClient: PublicClient<Transport, Chain>
        walletClients: {
            private?: WalletClient<Transport, Chain>
            public: WalletClient<Transport, Chain>
        }
    }
): AltoConfig {
    const { logger, ...rest } = config

    return {
        ...rest,
        chainId: config.publicClient.chain.id,
        utilityWalletAddress:
            config.utilityPrivateKey?.address ??
            "0x4337000c2828F5260d8921fD25829F606b9E8680",
        getLogger: (bindings, options) => logger.child(bindings, options)
    }
}
