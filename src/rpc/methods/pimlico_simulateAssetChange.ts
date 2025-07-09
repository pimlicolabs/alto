import { createMethodHandler } from "../createMethodHandler"
import { pimlicoSimulateAssetChangeSchema } from "@alto/types"
import { getUserOpHash } from "@alto/utils"

export const pimlicoSimulateAssetChangeHandler = createMethodHandler({
    method: "pimlico_simulateAssetChange",
    schema: pimlicoSimulateAssetChangeSchema,
    handler: async ({ rpcHandler, params }) => {
        const [userOp, entryPoint, addresses, tokens] = params

        const userOpHash = await getUserOpHash({
            userOp,
            entryPointAddress: entryPoint,
            chainId: rpcHandler.config.chainId,
            publicClient: rpcHandler.config.publicClient
        })

        const childLogger = rpcHandler.logger.child({
            userOpHash,
            entryPoint,
            addresses,
            tokens
        })
        childLogger.debug("pimlico_simulateAssetChange")

        // TODO: Implement asset change simulation logic
        // 1. Run simulation to get state changes
        // 2. Calculate token balance differences for each address/token pair
        // 3. Return the diff values

        // Return empty array matching the schema
        return []
    }
})
