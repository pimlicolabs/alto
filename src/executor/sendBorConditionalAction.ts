import {
    Account,
    Chain,
    Client,
    PublicClient,
    SendRawTransactionParameters,
    Transport
} from "viem"

export function sendConditionalAction<
    transport extends Transport = Transport,
    chain extends Chain | undefined = Chain | undefined,
    account extends Account | undefined = Account | undefined
>({
    publicClient,
    solverSigner
}: { publicClient: PublicClient; solverSigner: Account }) {
    return async (client: Client<transport, chain, account>) => {
        return {
            sendRawTransaction: async ({
                serializedTransaction
            }: SendRawTransactionParameters) => {
                try {
                    console.log("Sending conditional action...")

                    const conditionalOps = {
                        knownAccounts: {},
                        blockNumberMax: 0
                    }

                    const tx = await client.request({
                        // @ts-ignore
                        method: "bor_sendRawTransactionConditional",
                        // @ts-ignore
                        params: [serializedTransaction, {}]
                    })
                } catch (e) {
                    console.log(e)
                }
            }
        }
    }
}
