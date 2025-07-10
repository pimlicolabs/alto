import { chainIdSchema } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"

export const ethChainIdHandler = createMethodHandler({
    method: "eth_chainId",
    schema: chainIdSchema,
    handler: ({ rpcHandler }) => {
        return BigInt(rpcHandler.config.chainId)
    }
})
