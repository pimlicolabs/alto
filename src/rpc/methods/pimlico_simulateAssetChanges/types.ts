import { Address } from "abitype"
import { Hex } from "viem"

export type LogType = { address: Address; data: Hex; topics: Hex[] }
export type TokenType = "ERC-20" | "ERC-721" | "ERC-1155"
export type Metadata = { name?: string; symbol?: string; decimals?: number }

export type TokenInfo = {
    type: TokenType
    metadata: Metadata
}
