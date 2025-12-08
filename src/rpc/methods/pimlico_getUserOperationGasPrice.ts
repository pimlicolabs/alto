import { pimlicoGetUserOperationGasPriceSchema } from "@alto/types"
import { scaleBigIntByPercent } from "../../utils/bigInt"
import { createMethodHandler } from "../createMethodHandler"

export const pimlicoGetUserOperationGasPriceHandler = createMethodHandler({
    method: "pimlico_getUserOperationGasPrice",
    schema: pimlicoGetUserOperationGasPriceSchema,
    handler: async ({ rpcHandler }) => {
        const startTime = performance.now()

        const gasPriceStart = performance.now()
        let { maxFeePerGas, maxPriorityFeePerGas } =
            await rpcHandler.gasPriceManager.getGasPrice()
        const gasPriceDuration = performance.now() - gasPriceStart

        if (rpcHandler.config.chainType === "hedera") {
            maxFeePerGas /= 10n ** 9n
            maxPriorityFeePerGas /= 10n ** 9n
        }

        const { slow, standard, fast } = rpcHandler.config.gasPriceMultipliers

        const result = {
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

        const totalDuration = performance.now() - startTime

        rpcHandler.logger.info(
            {
                gasPriceDurationMs: gasPriceDuration.toFixed(2),
                totalDurationMs: totalDuration.toFixed(2)
            },
            "pimlico_getUserOperationGasPrice timing"
        )

        return result
    }
})
