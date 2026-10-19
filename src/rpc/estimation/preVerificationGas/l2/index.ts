import type { GasPriceManager } from "@alto/handlers"
import type { Address, UserOperation } from "@alto/types"
import { isVersion07, randomBigInt } from "@alto/utils"
import type { AltoConfig } from "../../../../createConfig"
import { calcArbitrumPvg } from "./arbitrum"
import { calcCitreaPvg } from "./citrea"
import { calcEtherlinkPvg } from "./etherlink"
import { calcMantlePvg } from "./mantle"
import { calcOptimismPvg } from "./optimism"

// Calculate the L2-specific gas component of preVerificationGas
export async function calcL2PvgComponent({
    config,
    userOp,
    entryPoint,
    gasPriceManager,
    validate
}: {
    config: AltoConfig
    userOp: UserOperation
    entryPoint: Address
    gasPriceManager: GasPriceManager
    validate: boolean
}): Promise<bigint> {
    let simulationUserOp = {
        ...userOp
    }

    // Add random gasFields during estimations
    if (!validate) {
        simulationUserOp = {
            ...simulationUserOp,
            callGasLimit: randomBigInt({ upper: 10_000_000n }),
            verificationGasLimit: randomBigInt({ upper: 10_000_000n }),
            preVerificationGas: randomBigInt({ upper: 10_000_000n })
        }

        if (isVersion07(simulationUserOp)) {
            simulationUserOp = {
                ...simulationUserOp,
                paymasterVerificationGasLimit: randomBigInt({
                    upper: 10_000_000n
                }),
                paymasterPostOpGasLimit: randomBigInt({
                    upper: 10_000_000n
                })
            }
        }
    }

    switch (config.chainType) {
        case "op-stack":
            return await calcOptimismPvg(
                config.publicClient,
                simulationUserOp,
                entryPoint,
                gasPriceManager,
                validate
            )
        case "arbitrum":
            return await calcArbitrumPvg(
                config.publicClient,
                simulationUserOp,
                entryPoint,
                gasPriceManager,
                validate
            )
        case "mantle":
            return await calcMantlePvg(
                config.publicClient,
                simulationUserOp,
                entryPoint,
                gasPriceManager,
                validate
            )
        case "etherlink":
            return await calcEtherlinkPvg(
                simulationUserOp,
                entryPoint,
                gasPriceManager,
                validate
            )
        case "citrea":
            return await calcCitreaPvg(config, gasPriceManager, validate)
        default:
            return 0n
    }
}
