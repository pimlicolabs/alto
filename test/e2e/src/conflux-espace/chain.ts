import {
    type Chain,
    createPublicClient,
    defineChain,
    http,
    parseEther
} from "viem"
import { CONFLUX_ESPACE_TESTNET_NAME } from "./constants.js"

export const MIN_SIMPLE_ACCOUNT_BALANCE = parseEther("0.05")

export const getConfluxEspaceChain = async ({
    rpcUrl
}: {
    rpcUrl: string
}): Promise<Chain> => {
    const probeClient = createPublicClient({
        transport: http(rpcUrl)
    })

    const chainId = await probeClient.getChainId()

    return defineChain({
        id: chainId,
        name: CONFLUX_ESPACE_TESTNET_NAME,
        nativeCurrency: {
            name: "Conflux",
            symbol: "CFX",
            decimals: 18
        },
        rpcUrls: {
            default: {
                http: [rpcUrl]
            },
            public: {
                http: [rpcUrl]
            }
        }
    })
}
