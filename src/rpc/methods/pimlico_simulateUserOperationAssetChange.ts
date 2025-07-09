import type { Address } from "@alto/types"
import { createMethodHandler } from "@alto/utils"

export const pimlicoSimulateUserOperationAssetChangeHandler = createMethodHandler(
    async ({
        params,
        validator,
        utilityWalletAddress,
        logger
    }) => {
        const [userOp, entryPoint, addresses, tokens] = params

        const childLogger = logger.child({
            userOpHash: validator.getUserOperationHash(userOp, entryPoint),
            utilityWalletAddress,
            entryPoint,
            addresses,
            tokens
        })
        childLogger.debug("pimlico_simulateUserOperationAssetChange")

        // TODO: Implement asset change simulation logic
        // 1. Run simulation to get state changes
        // 2. Calculate token balance differences for each address/token pair
        // 3. Return the diff values

        return {
            tokenChanges: []
        }
    }
)