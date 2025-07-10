import type { UserOperation } from "@alto/types"
import type { StateOverrides, UserOperationV07 } from "@alto/types"
import { isVersion06 } from "@alto/utils"
import type { Hex } from "viem"
import type { Address } from "viem"
import type { AltoConfig } from "../../createConfig"
import { GasEstimatorV06 } from "./gasEstimations06"
import { GasEstimatorV07 } from "./gasEstimations07"
import type { SimulateHandleOpResult } from "./types"

export class GasEstimationHandler {
    gasEstimatorV06: GasEstimatorV06
    gasEstimatorV07: GasEstimatorV07

    constructor(config: AltoConfig) {
        this.gasEstimatorV06 = new GasEstimatorV06(config)

        this.gasEstimatorV07 = new GasEstimatorV07(config)
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
            return this.gasEstimatorV06.simulateHandleOpV06({
                userOp,
                entryPoint,
                targetAddress,
                targetCallData,
                userStateOverrides: stateOverrides
            })
        }

        return this.gasEstimatorV07.validateHandleOpV07({
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
            return this.gasEstimatorV06.simulateHandleOpV06({
                userOp,
                entryPoint,
                targetAddress,
                targetCallData,
                userStateOverrides: stateOverrides
            })
        }

        return this.gasEstimatorV07.simulateHandleOp07({
            userOp: userOp as UserOperationV07,
            queuedUserOps: queuedUserOps as UserOperationV07[],
            entryPoint,
            userStateOverrides: stateOverrides
        })
    }
}
