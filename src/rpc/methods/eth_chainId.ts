import { createMethodHandler } from "../types"
import { chainIdSchema } from "@alto/types"

export const ethChainIdHandler = createMethodHandler({
    method: "eth_chainId",
    schema: chainIdSchema.shape.params,
    responseSchema: chainIdSchema.shape.result,
    handler: async ({ meta }) => {
        return BigInt(meta.config.publicClient.chain.id)
    }
})
