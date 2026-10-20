import type { GasPriceManager } from "@alto/handlers"
import type { Address, UserOperation } from "@alto/types"
import { isVersion07, randomBigInt } from "@alto/utils"
import type { AltoConfig } from "../../../../createConfig"
import { getArbitrumPvg } from "./arbitrum"
import { getCitreaPvg } from "./citrea"
import { getEtherlinkPvg } from "./etherlink"
import { getMantlePvg } from "./mantle"
import { getOptimismPvg } from "./optimism"

// Calculate the L2-specific gas component of preVerificationGas
export async function getL2PvgComponent({
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
            return await getOptimismPvg(
                config.publicClient,
                simulationUserOp,
                entryPoint,
                gasPriceManager,
                validate
            )
        case "arbitrum":
            return await getArbitrumPvg(
                config.publicClient,
                simulationUserOp,
                entryPoint,
                gasPriceManager,
                validate
            )
        case "mantle":
            return await getMantlePvg(
                config.publicClient,
                simulationUserOp,
                entryPoint,
                gasPriceManager,
                validate
            )
        case "etherlink":
            return await getEtherlinkPvg(
                simulationUserOp,
                entryPoint,
                gasPriceManager,
                validate
            )
        case "citrea":
            return await getCitreaPvg(config, gasPriceManager, validate)
        default:
            return 0n
    }
}
