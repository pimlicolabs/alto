import { scaleBigIntByPercent } from "../../utils/bigInt"
import { createMethodHandler } from "../types"
import { pimlicoGetUserOperationGasPriceSchema } from "@alto/types"

export const pimlicoGetUserOperationGasPriceHandler = createMethodHandler({
    method: "pimlico_getUserOperationGasPrice",
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
                maxFeePerGas: scaleBigIntByPercent(maxFeePerGas, slow),
                maxPriorityFeePerGas: scaleBigIntByPercent(
                    maxPriorityFeePerGas,
                    slow
                )
            },
            standard: {
                maxFeePerGas: scaleBigIntByPercent(maxFeePerGas, standard),
                maxPriorityFeePerGas: scaleBigIntByPercent(
                    maxPriorityFeePerGas,
                    standard
                )
            },
            fast: {
                maxFeePerGas: scaleBigIntByPercent(maxFeePerGas, fast),
                maxPriorityFeePerGas: scaleBigIntByPercent(
                    maxPriorityFeePerGas,
                    fast
                )
            }
        }
    }
})
