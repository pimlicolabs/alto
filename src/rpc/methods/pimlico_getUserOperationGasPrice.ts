import { createMethodHandler } from "../types"
import { pimlicoGetUserOperationGasPriceSchema } from "@alto/types"

export const pimlicoGetUserOperationGasPriceHandler = createMethodHandler({
    schema: pimlicoGetUserOperationGasPriceSchema,
    handler: async ({ relay }) => {
        let { maxFeePerGas, maxPriorityFeePerGas } =
            await relay.gasPriceManager.getGasPrice()

        if (relay.config.chainType === "hedera") {
            maxFeePerGas /= 10n ** 9n
            maxPriorityFeePerGas /= 10n ** 9n
        }

        const { slow, standard, fast } = relay.config.gasPriceMultipliers

        return {
            slow: {
                maxFeePerGas: (maxFeePerGas * slow) / 100n,
                maxPriorityFeePerGas: (maxPriorityFeePerGas * slow) / 100n
            },
            standard: {
                maxFeePerGas: (maxFeePerGas * standard) / 100n,
                maxPriorityFeePerGas: (maxPriorityFeePerGas * standard) / 100n
            },
            fast: {
                maxFeePerGas: (maxFeePerGas * fast) / 100n,
                maxPriorityFeePerGas: (maxPriorityFeePerGas * fast) / 100n
            }
        }
    }
})
