import type { GasPriceManager } from "@alto/handlers"
import type {
    StateOverrides,
    UserOperation,
    UserOperation07
} from "@alto/types"
import { isVersion06 } from "@alto/utils"
import type { Address, Hex } from "viem"
import type { AltoConfig } from "../../createConfig"
import { TX_MAX_GAS_LIMIT } from "../../utils/eip8037"
import { GasEstimator06 } from "./gasEstimations06"
import { GasEstimator07 } from "./gasEstimations07"
import type { SimulateHandleOpResult } from "./types"

export class GasEstimationHandler {
    gasEstimator06: GasEstimator06
    gasEstimator07: GasEstimator07

    constructor(
        config: AltoConfig,
        gasPriceManager: GasPriceManager,
        simulationGasLimit = config.fixedGasLimitForEstimation
    ) {
        this.gasEstimator06 = new GasEstimator06(config, simulationGasLimit)
        this.gasEstimator07 = new GasEstimator07(
            config,
            gasPriceManager,
            simulationGasLimit
        )
    }

    validateHandleOp({
        userOp,
        queuedUserOps,
        entryPoint,
        targetAddress,
        targetCallData,
        stateOverrides = {}
    }: {
        userOp: UserOperation
        queuedUserOps: UserOperation[]
        entryPoint: Address
        targetAddress: Address
        targetCallData: Hex
        stateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult> {
        if (isVersion06(userOp)) {
            return this.gasEstimator06.simulateHandleOp06({
                userOp,
                entryPoint,
                targetAddress,
                targetCallData,
                userStateOverrides: stateOverrides
            })
        }

        return this.gasEstimator07.validateHandleOp07({
            userOp: userOp as UserOperation07,
            queuedUserOps: queuedUserOps as UserOperation07[],
            entryPoint,
            stateOverrides
        })
    }

    simulateHandleOp({
        userOp,
        queuedUserOps,
        entryPoint,
        targetAddress,
        targetCallData,
        stateOverrides = {}
    }: {
        userOp: UserOperation
        queuedUserOps: UserOperation[]
        entryPoint: Address
        targetAddress: Address
        targetCallData: Hex
        stateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult> {
        if (isVersion06(userOp)) {
            return this.gasEstimator06.simulateHandleOp06({
                userOp,
                entryPoint,
                targetAddress,
                targetCallData,
                userStateOverrides: stateOverrides
            })
        }

        return this.gasEstimator07.simulateHandleOp07({
            userOp: userOp as UserOperation07,
            queuedUserOps: queuedUserOps as UserOperation07[],
            entryPoint,
            userStateOverrides: stateOverrides
        })
    }

    // Smallest EIP-8037 state gas reservoir the userOp passes with (0 if it
    // passes without one), or undefined if it fails even with
    // maxReservoirGas. The simulation's gas limit above TX_MAX_GAS_LIMIT is
    // the reservoir, so eth_estimateGas finds it in one call. Searching on
    // pass/fail covers the userOp's peak state gas, which is above its net
    // state gas when it clears state it created earlier.
    async findReservoirGas({
        userOp,
        queuedUserOps,
        entryPoint,
        stateOverrides,
        maxReservoirGas
    }: {
        userOp: UserOperation
        queuedUserOps: UserOperation[]
        entryPoint: Address
        stateOverrides?: StateOverrides
        maxReservoirGas: bigint
    }): Promise<bigint | undefined> {
        const gasCap = TX_MAX_GAS_LIMIT + maxReservoirGas
        const gas = isVersion06(userOp)
            ? await this.gasEstimator06.estimateHandleOpGas06({
                  userOp,
                  entryPoint,
                  userStateOverrides: stateOverrides,
                  gasCap
              })
            : await this.gasEstimator07.estimateHandleOpGas07({
                  userOp: userOp as UserOperation07,
                  queuedUserOps: queuedUserOps as UserOperation07[],
                  entryPoint,
                  userStateOverrides: stateOverrides,
                  gasCap
              })

        if (gas === undefined) {
            return undefined
        }

        return gas > TX_MAX_GAS_LIMIT ? gas - TX_MAX_GAS_LIMIT : 0n
    }
}
