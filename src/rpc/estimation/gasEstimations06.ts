import type { StateOverrides, UserOperation06 } from "@alto/types"
import type { Logger } from "@alto/utils"
import { type Address, type Hex, getContract } from "viem"
import { entryPoint06Abi } from "viem/account-abstraction"
import type { AltoConfig } from "../../createConfig"
import type { SimulateHandleOpResult } from "./types"
import {
    decodeSimulateHandleOpError,
    prepareSimulationOverrides06,
    simulationErrors
} from "./utils"

export class GasEstimator06 {
    private readonly config: AltoConfig
    private readonly logger: Logger

    constructor(config: AltoConfig) {
        this.config = config
        this.logger = config.getLogger(
            {
                module: "gas-estimator-v06"
            },
            {
                level: config.logLevel
            }
        )
    }

    async simulateHandleOp06({
        userOp,
        targetAddress,
        targetCallData,
        entryPoint,
        useCodeOverride = true,
        userStateOverrides = undefined
    }: {
        userOp: UserOperation06
        targetAddress: Address
        targetCallData: Hex
        entryPoint: Address
        useCodeOverride?: boolean
        userStateOverrides?: StateOverrides
    }): Promise<SimulateHandleOpResult> {
        const {
            publicClient,
            //blockTagSupport,
            utilityWalletAddress,
            fixedGasLimitForEstimation
        } = this.config

        const viemStateOverride = await prepareSimulationOverrides06({
            userOp,
            entryPoint,
            userStateOverrides,
            useCodeOverride,
            config: this.config
        })

        const entryPointContract = getContract({
            address: entryPoint,
            abi: [...entryPoint06Abi, ...simulationErrors],
            client: publicClient
        })

        try {
            await entryPointContract.simulate.simulateHandleOp(
                [userOp, targetAddress, targetCallData],
                {
                    account: utilityWalletAddress,
                    gas: fixedGasLimitForEstimation,
                    stateOverride: viemStateOverride
                }
            )
            // simulateHandleOp should always revert, if it doesn't something is wrong
            throw new Error("simulateHandleOp did not revert")
        } catch (e) {
            return decodeSimulateHandleOpError(e, this.logger)
        }
    }
}
