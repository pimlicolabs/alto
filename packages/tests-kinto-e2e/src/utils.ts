import type { UserOperation } from "permissionless"
import { defineChain, type Hex, type Hash, type Address } from "viem"

export const prettyPrintTxHash = (hash: Hash) => {
    return `https://kintoscan.io/tx/${hash}`
}

export type CompressedOp = {
    compressedBytes: Hex
    inflator: Address
}

export type OpInfoType = {
    opHash: Hex
    txHash: Hex
    blockNum: bigint
    opParams: UserOperation | CompressedOp
}

export const isCompressed = (
    op: UserOperation | CompressedOp
): op is CompressedOp => {
    return "inflator" in op
}

export const kintoMainnet = defineChain({
    id: 7887,
    name: "Kinto Mainnet",
    nativeCurrency: {
        name: "ETH",
        symbol: "ETH",
        decimals: 18
    },
    rpcUrls: {
        default: {
            http: [],
            webSocket: undefined
        }
    }
})

export const KINTO_ENTRYPOINT = "0x2843C269D2a64eCfA63548E8B3Fc0FD23B7F70cb"
export const KINTO_RPC = process.env.KINTO_RPC

export const sleep = async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
}
