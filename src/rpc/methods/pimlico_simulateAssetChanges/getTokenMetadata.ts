import { Address, parseAbi } from "abitype"
import { Logger } from "pino"
import {
    PublicClient,
    encodeFunctionData,
    hexToBool,
    erc20Abi,
    decodeAbiParameters
} from "viem"

// ERC-165 interface ID for ERC-721 and ERC-1155
const ERC721_INTERFACE_ID = "0x80ac58cd"
const ERC1155_INTERFACE_ID = "0xd9b67a26"

type TokenType = "ERC-20" | "ERC-721" | "ERC-1155"
type Metadata = { name?: string; symbol?: string; decimals?: number }

type TokenInfo = {
    type: TokenType
    metadata: Metadata
}

export const getMetadata = async (
    address: Address,
    tokenType: TokenType,
    tevmClient: PublicClient,
    logger: Logger
): Promise<Metadata> => {
    const metadata: { name?: string; symbol?: string; decimals?: number } = {}

    // Try to get name
    try {
        const nameResult = await tevmClient.call({
            to: address,
            data: encodeFunctionData({
                abi: parseAbi(["function name() view returns (string)"]),
                functionName: "name"
            })
        })
        if (nameResult.data) {
            metadata.name = decodeAbiParameters(
                [{ type: "string" }],
                nameResult.data
            )[0]
        }
    } catch (err) {
        logger.debug({ err }, `Error getting ${tokenType} token name`)
    }

    // Try to get symbol
    try {
        const symbolResult = await tevmClient.call({
            to: address,
            data: encodeFunctionData({
                abi: parseAbi(["function symbol() view returns (string)"]),
                functionName: "symbol"
            })
        })
        if (symbolResult.data) {
            metadata.symbol = decodeAbiParameters(
                [{ type: "string" }],
                symbolResult.data
            )[0]
        }
    } catch (err) {
        logger.debug({ err }, `Error getting ${tokenType} token symbol`)
    }

    // For ERC-20 tokens, also fetch decimals
    if (tokenType === "ERC-20") {
        try {
            const decimalsResult = await tevmClient.call({
                to: address,
                data: encodeFunctionData({
                    abi: erc20Abi,
                    functionName: "decimals"
                })
            })
            if (decimalsResult.data) {
                metadata.decimals = decodeAbiParameters(
                    [{ type: "uint8" }],
                    decimalsResult.data
                )[0]
            }
        } catch (err) {
            logger.debug({ err }, "Error getting ERC-20 token decimals")
        }
    }

    return metadata
}

const isErc1155 = async (
    address: Address,
    tevmClient: PublicClient,
    logger: Logger
): Promise<TokenInfo | undefined> => {
    try {
        // ERC-1155 *must* implement ERC-165
        const supportsInterface = await tevmClient.call({
            to: address,
            data: encodeFunctionData({
                abi: parseAbi([
                    "function supportsInterface(bytes4) returns (bool)"
                ]),
                args: [ERC1155_INTERFACE_ID]
            })
        })

        if (hexToBool(supportsInterface.data || "0x0")) {
            return {
                type: "ERC-1155",
                metadata: await getMetadata(
                    address,
                    "ERC-1155",
                    tevmClient,
                    logger
                )
            }
        }
    } catch (err) {
        // Log any errors but continue with our default assumption
        logger.debug(
            { err },
            `Failed to determine if ${address} is ERC-1155, assuming false`
        )
    }

    return undefined
}

const isErc721 = async (
    address: Address,
    tevmClient: PublicClient,
    logger: Logger
): Promise<TokenInfo | undefined> => {
    try {
        // ERC-721 *must* implement ERC-165
        const supportsErc721Response = await tevmClient.call({
            to: address,
            data: encodeFunctionData({
                abi: parseAbi([
                    "function supportsInterface(bytes4) returns (bool)"
                ]),
                args: [ERC721_INTERFACE_ID]
            })
        })

        if (hexToBool(supportsErc721Response.data || "0x0")) {
            return {
                type: "ERC-721",
                metadata: await getMetadata(
                    address,
                    "ERC-721",
                    tevmClient,
                    logger
                )
            }
        }
    } catch (err) {
        // Log any errors but continue with our default assumption
        logger.debug(
            { err },
            `Failed to determine if ${address} is ERC-721, assuming false`
        )
    }

    return undefined
}

export const isErc20 = async (
    address: Address,
    tevmClient: PublicClient,
    logger: Logger
): Promise<TokenInfo | undefined> => {
    try {
        // Check by calling a ERC-20 only method
        const totalSupplyResponse = await tevmClient.call({
            to: address,
            data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "decimals"
            })
        })

        if (totalSupplyResponse.data) {
            return {
                type: "ERC-20",
                metadata: await getMetadata(
                    address,
                    "ERC-20",
                    tevmClient,
                    logger
                )
            }
        }
    } catch (err) {
        logger.debug(
            { err },
            `Failed to determine if ${address} is ERC-20, assuming false`
        )
    }

    return undefined
}

// Cache for token info
const tokenInfoCache = new Map<Address, TokenInfo>()

export const getTokenInfo = async (
    address: Address,
    tevmClient: PublicClient,
    logger: Logger
): Promise<TokenInfo | undefined> => {
    const cached = tokenInfoCache.get(address)
    if (cached) return cached

    const erc20Info = await isErc20(address, tevmClient, logger)
    if (erc20Info) {
        tokenInfoCache.set(address, erc20Info)
        return erc20Info
    }

    const erc721Info = await isErc721(address, tevmClient, logger)
    if (erc721Info) {
        tokenInfoCache.set(address, erc721Info)
        return erc721Info
    }

    const isEip1155 = await isErc1155(address, tevmClient, logger)
    if (isEip1155) {
        tokenInfoCache.set(address, isEip1155)
        return isEip1155
    }

    return undefined
}
