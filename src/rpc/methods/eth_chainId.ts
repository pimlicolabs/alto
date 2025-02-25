import { createMethodHandler } from "../types"
import { chainIdSchema } from "@alto/types"

export const ethChainIdHandler = createMethodHandler({
    method: "eth_chainId",
    schema: chainIdSchema,
    handler: async ({ rpcHandler }) => {
        return BigInt(rpcHandler.config.publicClient.chain.id)
    }
})
