import {
    Hex,
    createClient,
    http,
    SendRawTransactionReturnType,
    Hash,
    WalletClient,
    PublicClient,
    toHex
} from "viem"
import { sendRawTransaction as sendRawTransaction_ } from "viem/actions"
import { getAction } from "viem/utils"

const pflClient = createClient({
    transport: http("https://polygon-rpc.fastlane.xyz")
})

export async function sendPflConditional({
    serializedTransaction,
    publicClient,
    walletClient
}: {
    serializedTransaction: Hash
    publicClient: PublicClient
    walletClient: WalletClient
}): Promise<SendRawTransactionReturnType> {
    try {
        console.log("Sending conditional action...")

        const blockNumberMin = await publicClient.getBlockNumber()
        const blockNumberMax = blockNumberMin + 25n

        const timestampMin = Date.now()
        const timestampMax = timestampMin + 10_000

        const opts = {
            //knownAccounts: {}
            blockNumberMin: Number(blockNumberMin),
            blockNumberMax: Number(blockNumberMax),
            timestampMin: Math.floor(timestampMin / 1000),
            timestampMax: Math.floor(timestampMax / 1000)
        }

        const txHash = (await pflClient.request({
            // @ts-ignore
            method: "pfl_sendRawTransactionConditional",
            // @ts-ignore
            params: [serializedTransaction, opts]
        })) as Hex

        console.log(txHash)

        return txHash
    } catch (e) {
        console.log(`Error sending conditional action: ${e}`)
        return getAction(
            walletClient,
            sendRawTransaction_,
            "sendRawTransaction"
        )({ serializedTransaction })
    }
}
