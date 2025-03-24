import { createMethodHandler } from "../createMethodHandler"
import { chainIdSchema } from "@alto/types"

export const ethChainIdHandler = createMethodHandler({
    method: "eth_chainId",
    schema: chainIdSchema,
    handler: ({ rpcHandler }) => {
        return BigInt(rpcHandler.config.chainId)
    }
})
