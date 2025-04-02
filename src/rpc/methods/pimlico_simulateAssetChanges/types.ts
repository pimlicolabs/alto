import { Address, parseAbi } from "abitype"
import { Hex, toEventSelector } from "viem"

export type LogType = { address: Address; data: Hex; topics: Hex[] }
export type TokenType = "ERC-20" | "ERC-721" | "ERC-1155"
export type Metadata = { name?: string; symbol?: string; decimals?: number }

export type TokenInfo = {
    type: TokenType
    metadata: Metadata
}

// Both ERC-20 and ERC-721 use the same event signature
export const TRANSFER_TOPIC_HASH = toEventSelector(
    "event Transfer(address indexed from, address indexed to, uint256 value)"
)

// ERC-1155 TransferSingle event
export const TRANSFER_SINGLE_TOPIC_HASH = toEventSelector(
    "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)"
)

// ERC-1155 TransferBatch event
export const TRANSFER_BATCH_TOPIC_HASH = toEventSelector(
    "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)"
)

export const erc1155Abi = parseAbi([
    "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
    "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
    "function balanceOfBatch(address[] accounts, uint256[] ids) external view returns (uint256[])"
])
