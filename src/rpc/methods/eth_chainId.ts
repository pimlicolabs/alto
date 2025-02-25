import { createMethodHandler } from "../types"
import { chainIdSchema } from "@alto/types"

export const ethChainIdHandler = createMethodHandler({
    schema: chainIdSchema,
    handler: async ({ relay }) => {
        return BigInt(relay.config.publicClient.chain.id)
    }
})
