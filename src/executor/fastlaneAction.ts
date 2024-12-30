import {
    Chain,
    Client,
    Transport,
    Hex,
    createClient,
    http,
    SendRawTransactionReturnType
} from "viem"
import { sendRawTransaction as sendRawTransaction_ } from "viem/actions"
import { getAction } from "viem/utils"

type SendPflConditionalArgs<
    transport extends Transport = Transport,
    chain extends Chain | undefined = Chain | undefined
> = {
    serializedTransaction: Hex
    pflClient: Client<transport, chain>
}

export type FastlaneActions<
    transport extends Transport = Transport,
    chain extends Chain | undefined = Chain | undefined
> = {
    sendPflConditional: (
        client: Client<transport, chain>,
        { serializedTransaction, pflClient }: SendPflConditionalArgs
    ) => Promise<SendRawTransactionReturnType>
}

export async function sendPflConditional<chain extends Chain | undefined>(
    client: Client<Transport, chain>,
    { serializedTransaction, pflClient }: SendPflConditionalArgs
): Promise<SendRawTransactionReturnType> {
    try {
        const txHash = (await pflClient.request({
            // @ts-ignore
            method: "pfl_sendRawTransactionConditional",
            params: [serializedTransaction]
        })) as Hex

        return txHash
    } catch (e) {
        return getAction(
            client,
            sendRawTransaction_,
            "sendRawTransaction"
        )({ serializedTransaction })
    }
}

export function fastlaneActions<
    transport extends Transport = Transport,
    chain extends Chain | undefined = Chain | undefined
>(): FastlaneActions<transport, chain> {
    const pflClient = createClient({
        transport: http("https://polygon-rpc.fastlane.xyz")
    })

    return {
        // Currently only supports sending userOperations to EntryPoint v0.6
        sendPflConditional: async (
            client: Client<transport, chain>,
            { serializedTransaction }: SendPflConditionalArgs
        ) =>
            await sendPflConditional(client, {
                pflClient,
                serializedTransaction
            })
    }
}
