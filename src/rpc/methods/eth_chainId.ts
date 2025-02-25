import { createMethodHandler } from "../types"
import { chainIdSchema } from "@alto/types"

export const ethChainIdHandler = createMethodHandler({
    method: "eth_chainId",
    schema: chainIdSchema,
    handler: async ({ relay }) => {
        return BigInt(relay.config.publicClient.chain.id)
    }
})
