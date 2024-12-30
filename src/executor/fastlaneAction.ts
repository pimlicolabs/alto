import {
    Chain,
    Client,
    Transport,
    Hex,
    createClient,
    http,
    SendRawTransactionReturnType,
    Account
} from "viem"
import { sendRawTransaction as sendRawTransaction_ } from "viem/actions"
import { getAction } from "viem/utils"

type SendPflConditionalArgs<
    chain extends Chain | undefined = Chain | undefined,
    transport extends Transport = Transport
> = {
    serializedTransaction: Hex
    pflClient: Client<transport, chain>
}

export type FastlaneActions = {
    sendPflConditional: ({
        serializedTransaction,
        pflClient
    }: SendPflConditionalArgs) => Promise<SendRawTransactionReturnType>
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

export function fastlaneActions() {
    return <
        transport extends Transport = Transport,
        chain extends Chain | undefined = Chain | undefined,
        account extends Account | undefined = Account | undefined
    >(
        client: Client<transport, chain, account>
    ): FastlaneActions => {
        const pflClient = createClient({
            transport: http("https://polygon-rpc.fastlane.xyz")
        })

        return {
            sendPflConditional: ({
                serializedTransaction
            }: SendPflConditionalArgs) =>
                sendPflConditional(client, {
                    pflClient,
                    serializedTransaction
                })
        }
    }
}
