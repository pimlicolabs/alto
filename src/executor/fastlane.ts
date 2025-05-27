import type { Logger } from "@alto/utils"
import {
    http,
    BaseError,
    type Hash,
    type Hex,
    type PublicClient,
    type SendRawTransactionReturnType,
    type WalletClient,
    createClient,
    toHex
} from "viem"

const pflClient = createClient({
    transport: http("https://polygon-rpc.fastlane.xyz")
})

export async function sendPflConditional({
    serializedTransaction,
    publicClient,
    walletClient,
    logger
}: {
    serializedTransaction: Hash
    publicClient: PublicClient
    walletClient: WalletClient
    logger: Logger
}): Promise<SendRawTransactionReturnType> {
    try {
        const blockNumberMin = await publicClient.getBlockNumber()
        const blockNumberMax = blockNumberMin + 30n

        const timestampMin = Date.now() / 1000
        const timestampMax = timestampMin + 60

        const opts = {
            //knownAccounts: {}
            blockNumberMin: toHex(blockNumberMin),
            blockNumberMax: toHex(blockNumberMax),
            timestampMin: Math.floor(timestampMin),
            timestampMax: Math.floor(timestampMax)
        }

        const txHash = (await pflClient.request({
            // @ts-ignore
            method: "pfl_sendRawTransactionConditional",
            // @ts-ignore
            params: [serializedTransaction, opts]
        })) as Hex

        if (!txHash) {
            const error = new BaseError(
                "FastLane API returned empty transaction hash"
            )
            error.details =
                "PFL conditional transaction failed: No txHash in response"
            throw error
        }

        return txHash
    } catch (e: unknown) {
        logger.error(
            "Error sending through pfl_sendRawTransactionConditional ",
            (e as any)?.details
        )
        return await walletClient.sendRawTransaction({ serializedTransaction })
    }
}
