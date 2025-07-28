import { chainIdRequestSchema } from "@alto/schemas"
import { createMethodHandler } from "../createMethodHandler"

export const ethChainIdHandler = createMethodHandler({
    method: "eth_chainId",
    schema: chainIdRequestSchema,
    handler: ({ rpcHandler }) => {
        return BigInt(rpcHandler.config.chainId)
    }
})
