import type { GasPriceManager } from "@alto/handlers"
import type {
    StateOverrides,
    UserOperation,
    UserOperation07
} from "@alto/types"
import { isVersion06 } from "@alto/utils"
import { type Address, type Hex, zeroAddress } from "viem"
import type { AltoConfig } from "../../createConfig"
import {
    EIP8037_NEW_SLOT_STATE_GAS,
    TX_MAX_GAS_LIMIT
} from "../../utils/eip8037"
import { GasEstimator06 } from "./gasEstimations06"
import { GasEstimator07 } from "./gasEstimations07"
import type { SimulateHandleOpResult } from "./types"

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
        stateOverrides = {},
        gasLimit
    }: {
        userOp: UserOperation
        queuedUserOps: UserOperation[]
        entryPoint: Address
        targetAddress: Address
        targetCallData: Hex
        stateOverrides?: StateOverrides
        gasLimit?: bigint
    }): Promise<SimulateHandleOpResult> {
        if (isVersion06(userOp)) {
            return this.gasEstimator06.simulateHandleOp06({
                userOp,
                entryPoint,
                targetAddress,
                targetCallData,
                userStateOverrides: stateOverrides,
                gasLimit
            })
        }

        return this.gasEstimator07.validateHandleOp07({
            userOp: userOp as UserOperation07,
            queuedUserOps: queuedUserOps as UserOperation07[],
            entryPoint,
            stateOverrides,
            gasLimit
        })
    }

    simulateHandleOp({
        userOp,
        queuedUserOps,
        entryPoint,
        targetAddress,
        targetCallData,
        stateOverrides = {},
        gasLimit
    }: {
        userOp: UserOperation
        queuedUserOps: UserOperation[]
        entryPoint: Address
        targetAddress: Address
        targetCallData: Hex
        stateOverrides?: StateOverrides
        gasLimit?: bigint
    }): Promise<SimulateHandleOpResult> {
        if (isVersion06(userOp)) {
            return this.gasEstimator06.simulateHandleOp06({
                userOp,
                entryPoint,
                targetAddress,
                targetCallData,
                userStateOverrides: stateOverrides,
                gasLimit
            })
        }

        return this.gasEstimator07.simulateHandleOp07({
            userOp: userOp as UserOperation07,
            queuedUserOps: queuedUserOps as UserOperation07[],
            entryPoint,
            userStateOverrides: stateOverrides,
            gasLimit
        })
    }

    // Smallest EIP-8037 state gas reservoir the userOp passes with, or
    // undefined if it fails even with maxReservoirGas. Searching on
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
        const passes = async (reservoirGas: bigint) => {
            const result = await this.validateHandleOp({
                userOp,
                queuedUserOps,
                entryPoint,
                targetAddress: zeroAddress,
                targetCallData: "0x",
                stateOverrides,
                gasLimit: TX_MAX_GAS_LIMIT + reservoirGas
            })
            return result.result === "execution"
        }

        if (!(await passes(maxReservoirGas))) {
            return undefined
        }

        let low = 0n
        let high = maxReservoirGas
        while (high - low > EIP8037_NEW_SLOT_STATE_GAS) {
            const mid = (low + high) / 2n
            if (await passes(mid)) {
                high = mid
            } else {
                low = mid
            }
        }

        return high
    }
}
