import { createMethodHandler } from "../createMethodHandler"
import { pimlicoGetSimulationContractsSchema } from "@alto/types"

export const pimlicoGetSimulationContractsHandler = createMethodHandler({
    method: "pimlico_getSimulationContracts",
    schema: pimlicoGetSimulationContractsSchema,
    handler: async ({ rpcHandler }) => {
        const config = rpcHandler.config

        if (!config.pimlicoSimulationContract) {
            throw new Error("pimlicoSimulationContract not configured")
        }

        return {
            pimlicoSimulations: config.pimlicoSimulationContract,
            entrypointSimulations07: config.entrypointSimulationContractV7,
            entrypointSimulations08: config.entrypointSimulationContractV8
        }
    }
})

