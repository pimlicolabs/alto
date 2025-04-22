import { scaleBigIntByPercent } from "../../utils/bigInt"
import { createMethodHandler } from "../createMethodHandler"
import { pimlicoGetUserOperationGasPriceSchema } from "@alto/types"

export const pimlicoGetUserOperationGasPriceHandler = createMethodHandler({
    method: "pimlico_getUserOperationGasPrice",
    schema: pimlicoGetUserOperationGasPriceSchema,
    handler: async ({ rpcHandler }) => {
        const startTime = performance.now()
        rpcHandler.logger.info(`[LATENCY] STEP 5.3.1: Handler function started`)
        
        const getGasPriceStartTime = performance.now()
        let { maxFeePerGas, maxPriorityFeePerGas } =
            await rpcHandler.gasPriceManager.getGasPrice()
            
        const getGasPriceEndTime = performance.now()
        rpcHandler.logger.info(`[LATENCY] STEP 5.3.2: getGasPrice call completed: ${getGasPriceEndTime - getGasPriceStartTime}ms`)

        if (rpcHandler.config.chainType === "hedera") {
            maxFeePerGas /= 10n ** 9n
            maxPriorityFeePerGas /= 10n ** 9n
        }

        const scalingStartTime = performance.now()
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
        
        const endTime = performance.now()
        rpcHandler.logger.info(`[LATENCY] STEP 5.3.3: Gas price scaling completed: ${endTime - scalingStartTime}ms`)
        rpcHandler.logger.info(`[LATENCY] STEP 5.3.4: Total handler execution time: ${endTime - startTime}ms`)
        
        return result
    }
})
