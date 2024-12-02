import type { UserOperation } from "@alto/types"
import type { StateOverrides, UserOperationV07 } from "@alto/types"
import { deepHexlify, isVersion06 } from "@alto/utils"
import type { Hex } from "viem"
import { type Address, toHex } from "viem"
import { GasEstimatorV06 } from "./gasEstimationsV06"
import { GasEstimatorV07 } from "./gasEstimationsV07"
import type { SimulateHandleOpResult } from "./types"
import type { AltoConfig } from "@alto/config"

function getStateOverrides({
    addSenderBalanceOverride,
    userOperation,
    stateOverride = {}
}: {
    addSenderBalanceOverride: boolean
    stateOverride: StateOverrides
    userOperation: UserOperation
}) {
    const result: StateOverrides = { ...stateOverride }

    if (addSenderBalanceOverride) {
        result[userOperation.sender] = {
            ...deepHexlify(stateOverride?.[userOperation.sender] || {}),
            balance: toHex(100000_000000000000000000n)
        }
    }

    return result
}

export class GasEstimationHandler {
    gasEstimatorV06: GasEstimatorV06
    gasEstimatorV07: GasEstimatorV07

    constructor(config: AltoConfig) {
        this.gasEstimatorV06 = new GasEstimatorV06(config)

        this.gasEstimatorV07 = new GasEstimatorV07(config)
    }

    simulateHandleOp({
        userOperation,
        queuedUserOperations,
        addSenderBalanceOverride,
        entryPoint,
        targetAddress,
        targetCallData,
        balanceOverrideEnabled,
        stateOverrides = {}
    }: {
        userOperation: UserOperation
        queuedUserOperations: UserOperation[]
        addSenderBalanceOverride: boolean
        entryPoint: Address
        targetAddress: Address
        targetCallData: Hex
        balanceOverrideEnabled: boolean
        stateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult> {
        let finalStateOverride = undefined

        if (balanceOverrideEnabled) {
            finalStateOverride = getStateOverrides({
                userOperation,
                addSenderBalanceOverride,
                stateOverride: stateOverrides
            })
        }

        if (isVersion06(userOperation)) {
            return this.gasEstimatorV06.simulateHandleOpV06({
                userOperation,
                entryPoint,
                targetAddress,
                targetCallData,
                stateOverrides: finalStateOverride
            })
        }

        return this.gasEstimatorV07.simulateHandleOpV07({
            userOperation: userOperation as UserOperationV07,
            queuedUserOperations: queuedUserOperations as UserOperationV07[],
            entryPoint,
            stateOverrides: finalStateOverride
        })
    }
}
