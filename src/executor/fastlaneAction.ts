import {
    Chain,
    Client,
    Transport,
    Hex,
    createClient,
    http,
    SendRawTransactionReturnType,
    Account,
    SendRawTransactionParameters
} from "viem"
import { sendRawTransaction as sendRawTransaction_ } from "viem/actions"
import { getAction } from "viem/utils"

export type FastlaneActions = {
    sendPflConditional: ({
        serializedTransaction
    }: SendRawTransactionParameters) => Promise<SendRawTransactionReturnType>
}

export async function sendPflConditional<chain extends Chain | undefined>(
    client: Client<Transport, chain>,
    { serializedTransaction }: SendRawTransactionParameters
): Promise<SendRawTransactionReturnType> {
    try {
        const pflClient = createClient({
            transport: http("https://polygon-rpc.fastlane.xyz")
        })

        const txHash = (await pflClient.request({
            // @ts-ignore
            method: "pfl_sendRawTransactionConditional",
            params: [serializedTransaction]
        })) as Hex

        return txHash
    } catch (e) {
        return getAction(
        console.log()
            client,
            sendRawTransaction_,
            "sendRawTransaction"
        )({ serializedTransaction })
    }
}

export function fastlaneActions() {
    return <
        transport extends Transport = Transport,
        chain extends Chain | undefined = Chain | undefined,
        account extends Account | undefined = Account | undefined
    >(
        client: Client<transport, chain, account>
    ): FastlaneActions => {
        return {
            sendPflConditional: (args: SendRawTransactionParameters) =>
                sendPflConditional(client, args)
        }
    }
}
