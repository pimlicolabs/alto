import {
    Address,
    Hex,
    PublicClient,
    decodeEventLog,
    encodeFunctionData,
    erc20Abi,
    fromHex
} from "viem"
import { LogType, TokenInfo, TokenType } from "./types"
import { AssetChange } from "../../../types/schemas"

export async function getAssetChangesFromLogs(
    tokenAddress: Address,
    logs: LogType[],
    tokenInfo: TokenInfo,
    userOpSender: Address,
    tevmClient: PublicClient
): Promise<AssetChange[]> {
    const { type, metadata } = tokenInfo

    if (type === "ERC-20") {
        const diff = logs.reduce((acc, log) => {
            const decoded = decodeEventLog({
                abi: erc20Abi,
                data: log.data,
                eventName: "Transfer",
                topics: log.topics as [Hex, ...Hex[]]
            })

            const { from, value } = decoded.args

            // Add when receiving tokens, subtract when sending
            return from === userOpSender ? acc - value : acc + value
        }, 0n)

        const balance = await tevmClient.call({
            to: tokenAddress,
            data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [userOpSender]
            })
        })

        if (!balance.data) {
            throw new Error("Failed to get post balance")
        }

        const pre = fromHex(balance.data, "bigint")

        return [
            {
                token: {
                    tokenType: "ERC-20",
                    address: tokenAddress,
                    decimals: metadata.decimals as number,
                    name: metadata.name,
                    symbol: metadata.symbol
                },
                value: {
                    diff: diff,
                    pre,
                    post: pre + diff
                }
            }
        ]
    }

    if (type === "ERC-721") {
        return []
    }

    if (type === "ERC-1155") {
        return []
    }

    throw new Error("Invalid token type")
}
