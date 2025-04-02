import {
    Address,
    Hex,
    PublicClient,
    decodeAbiParameters,
    decodeEventLog,
    encodeFunctionData,
    erc20Abi,
    erc721Abi,
    fromHex
} from "viem"
import {
    LogType,
    TRANSFER_BATCH_TOPIC_HASH,
    TRANSFER_SINGLE_TOPIC_HASH,
    TokenInfo,
    erc1155Abi
} from "./types"
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
        const nftDiff = new Map<bigint, number>()

        for (const log of logs) {
            try {
                const decoded = decodeEventLog({
                    abi: erc721Abi,
                    data: log.data,
                    eventName: "Transfer",
                    topics: log.topics as [Hex, ...Hex[]]
                })

                const { from, to, tokenId } = decoded.args

                // If sender is sending the token
                if (from === userOpSender) {
                    const currentOwnership = nftDiff.get(tokenId) ?? 0
                    nftDiff.set(tokenId, currentOwnership - 1)
                }

                // If sender is receiving the token
                if (to === userOpSender) {
                    const currentOwnership = nftDiff.get(tokenId) ?? 0
                    nftDiff.set(tokenId, currentOwnership + 1)
                }
            } catch (error) {
                continue
            }
        }

        const assetChanges: AssetChange[] = []

        for (const [tokenId, diff] of nftDiff.entries()) {
            // No changes in balance
            if (diff === 0) {
                continue
            }

            assetChanges.push({
                token: {
                    tokenType: "ERC-721",
                    address: tokenAddress,
                    tokenId,
                    name: metadata.name,
                    symbol: metadata.symbol
                },
                value: {
                    diff: BigInt(diff),
                    pre: diff === 1 ? 0n : 1n,
                    post: diff === 1 ? 1n : 0n
                }
            })
        }

        return assetChanges
    }

    if (type === "ERC-1155") {
        const nftDiff = new Map<bigint, bigint>()

        for (const log of logs) {
            try {
                const eventSig = log.topics[0]

                if (eventSig === TRANSFER_SINGLE_TOPIC_HASH) {
                    const decoded = decodeEventLog({
                        abi: erc1155Abi,
                        data: log.data,
                        eventName: "TransferSingle",
                        topics: log.topics as [Hex, ...Hex[]]
                    })

                    const { from, to, id, value } = decoded.args

                    // If sender is sending the token
                    if (from === userOpSender) {
                        const currentOwnership = nftDiff.get(id) ?? 0n
                        nftDiff.set(id, currentOwnership - value)
                    }

                    // If sender is receiving the token
                    if (to === userOpSender) {
                        const currentOwnership = nftDiff.get(id) ?? 0n
                        nftDiff.set(id, currentOwnership + value)
                    }
                }

                if (eventSig === TRANSFER_BATCH_TOPIC_HASH) {
                    const decoded = decodeEventLog({
                        abi: erc1155Abi,
                        data: log.data,
                        eventName: "TransferBatch",
                        topics: log.topics as [Hex, ...Hex[]]
                    })

                    const { from, to, ids, values } = decoded.args

                    const zippedArray = Array.from(
                        { length: ids.length },
                        (_, i) => [ids[i], values[i]]
                    )

                    for (const [id, value] of zippedArray) {
                        // If sender is sending the token
                        if (from === userOpSender) {
                            const currentOwnership = nftDiff.get(id) ?? 0n
                            nftDiff.set(id, currentOwnership - value)
                        }

                        // If sender is receiving the token
                        if (to === userOpSender) {
                            const currentOwnership = nftDiff.get(id) ?? 0n
                            nftDiff.set(id, currentOwnership + value)
                        }
                    }
                }
            } catch (error) {
                continue
            }
        }

        const assetChanges: AssetChange[] = []

        const accounts = Array(nftDiff.size).fill(userOpSender)
        const ids = [...nftDiff.keys()]

        const call = await tevmClient.call({
            to: tokenAddress,
            data: encodeFunctionData({
                abi: erc1155Abi,
                functionName: "balanceOfBatch",
                args: [accounts, ids]
            })
        })

        if (!call.data) {
            throw new Error("Failed to get post balance")
        }

        const [startingBalances] = decodeAbiParameters(
            [{ type: "uint[]" }],
            call.data
        )

        const entries = [...nftDiff.entries()]
        const zip = Array.from({ length: entries.length }, (_, i) => [
            entries[i][0],
            entries[i][1],
            startingBalances[i]
        ])

        for (const [tokenId, diff, startingBalance] of zip) {
            // No changes in balance
            if (diff === 0n) {
                continue
            }

            assetChanges.push({
                token: {
                    tokenType: "ERC-1155",
                    address: tokenAddress,
                    tokenId,
                    name: metadata.name,
                    symbol: metadata.symbol
                },
                value: {
                    diff: BigInt(diff),
                    pre: startingBalance,
                    post: startingBalance + diff
                }
            })
        }
    }

    throw new Error("Invalid token type")
}
