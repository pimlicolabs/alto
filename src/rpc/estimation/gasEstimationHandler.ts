import type { UserOperation } from "@alto/types"
import type { StateOverrides, UserOperationV07 } from "@alto/types"
import { deepHexlify, isVersion06 } from "@alto/utils"
import type { Hex } from "viem"
import {
    toHex,
    type Address,
    parseEther,
    keccak256,
    encodeAbiParameters
} from "viem"
import { GasEstimatorV06 } from "./gasEstimationsV06"
import { GasEstimatorV07 } from "./gasEstimationsV07"
import type { SimulateHandleOpResult } from "./types"
import type { AltoConfig } from "../../createConfig"

function getStateOverrides({
    addSenderBalanceOverride,
    userOperation,
    entryPoint,
    stateOverrides = {}
}: {
    addSenderBalanceOverride: boolean
    stateOverrides: StateOverrides
    entryPoint: Address
    userOperation: UserOperation
}) {
    const result: StateOverrides = { ...stateOverrides }

    const balanceOverride = parseEther("1000000")

    if (addSenderBalanceOverride) {
        result[userOperation.sender] = {
            ...deepHexlify(stateOverrides?.[userOperation.sender] || {}),
            balance: toHex(balanceOverride)
        }

        // Add deposit override.
        const depositsMappingSlot = keccak256(
            encodeAbiParameters(
                [{ type: "address" }, { type: "uint256" }],
                [userOperation.sender, 0n]
            )
        )

        result[entryPoint] = {
            ...deepHexlify(stateOverrides?.[entryPoint] || {}),
            stateDiff: {
                ...(stateOverrides?.[entryPoint]?.stateDiff || {}),
                [depositsMappingSlot]: toHex(balanceOverride, { size: 32 })
            }
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
        let finalStateOverride = undefined

        // Add balance override only for v0.6 userOperations (so that prefund check during simulation passes).
        if (balanceOverrideEnabled && isVersion06(userOperation)) {
            finalStateOverride = getStateOverrides({
                userOperation,
                addSenderBalanceOverride,
                stateOverrides,
                entryPoint
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
            stateOverrides
        })
    }
}
