import type { UserOperation } from "@alto/types"
import type { StateOverrides, UserOperationV07 } from "@alto/types"
import { deepHexlify, isVersion06 } from "@alto/utils"
import type { Hex } from "viem"
import { toHex, type Address, parseEther } from "viem"
import { GasEstimatorV06 } from "./gasEstimationsV06"
import { GasEstimatorV07 } from "./gasEstimationsV07"
import type { SimulateHandleOpResult } from "./types"
import type { AltoConfig } from "../../createConfig"

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
        balanceOverrideEnabled,
        entryPoint,
        targetAddress,
        targetCallData,
        stateOverrides = {}
    }: {
        userOperation: UserOperation
        queuedUserOperations: UserOperation[]
        addSenderBalanceOverride: boolean
        balanceOverrideEnabled: boolean
        entryPoint: Address
        targetAddress: Address
        targetCallData: Hex
        stateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult> {
        // Add balance override (so that prefund check during simulation passes).
        if (balanceOverrideEnabled && addSenderBalanceOverride) {
            const sender = userOperation.sender
            stateOverrides[sender] = {
                ...deepHexlify(stateOverrides?.[sender] || {}),
                balance: toHex(parseEther("1000000"))
            }
        }

        if (isVersion06(userOperation)) {
            return this.gasEstimatorV06.simulateHandleOpV06({
                userOperation,
                entryPoint,
                targetAddress,
                targetCallData,
                stateOverrides
            })
        }

        return this.gasEstimatorV07.simulateHandleOpV07({
            userOperation: userOperation as UserOperationV07,
            queuedUserOperations: queuedUserOperations as UserOperationV07[],
            entryPoint,
            stateOverrides
        })
    }
}
