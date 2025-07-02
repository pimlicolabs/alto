import type { UserOperation } from "@alto/types"
import type { StateOverrides, UserOperationV07 } from "@alto/types"
import { isVersion06 } from "@alto/utils"
import type { Hex } from "viem"
import type { Address } from "viem"
import { GasEstimator06 } from "./gasEstimations06"
import { GasEstimator07 } from "./gasEstimations07"
import type { SimulateHandleOpResult } from "./types"
import type { AltoConfig } from "../../createConfig"
import type { GasPriceManager } from "@alto/handlers"

export class GasEstimationHandler {
    gasEstimator06: GasEstimator06
    gasEstimator07: GasEstimator07

    constructor(config: AltoConfig, gasPriceManager: GasPriceManager) {
        this.gasEstimator06 = new GasEstimator06(config)
        this.gasEstimator07 = new GasEstimator07(config, gasPriceManager)
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
            userOp: userOp as UserOperationV07,
            queuedUserOps: queuedUserOps as UserOperationV07[],
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
            userOp: userOp as UserOperationV07,
            queuedUserOps: queuedUserOps as UserOperationV07[],
            entryPoint,
            userStateOverrides: stateOverrides
        })
    }
}
