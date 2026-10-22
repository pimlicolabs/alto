import type { StateOverrides, UserOperation06 } from "@alto/types"
import type { Logger } from "@alto/utils"
import {
    type Abi,
    type Address,
    type Hex,
    encodeFunctionData,
    getContract
} from "viem"
import { entryPoint06Abi } from "viem/account-abstraction"
import entryPointOverride from "../../contracts/EntryPointGasEstimationOverride.sol/EntryPointGasEstimationOverride06.json" with {
    type: "json"
}
import type { AltoConfig } from "../../createConfig"
import type { SimulateHandleOpResult } from "./types"
import {
    decodeSimulateHandleOpError,
    isEstimateGasRevert,
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

    // Smallest transaction gas limit at which the userOp passes, with the call
    // phase capped at callGasLimit, or undefined if it fails even at gasCap
    async estimateHandleOpGas06({
        userOp,
        entryPoint,
        userStateOverrides,
        gasCap
    }: {
        userOp: UserOperation06
        entryPoint: Address
        userStateOverrides?: StateOverrides
        gasCap: bigint
    }): Promise<bigint | undefined> {
        const stateOverride = await prepareSimulationOverrides06({
            userOp,
            entryPoint,
            userStateOverrides,
            useCodeOverride: true,
            useCallGasLimit: true,
            config: this.config
        })

        try {
            return await this.config.publicClient.estimateGas({
                account: this.config.utilityWalletAddress,
                to: entryPoint,
                data: encodeFunctionData({
                    abi: entryPointOverride.abi as Abi,
                    functionName: "simulateHandleOpNoRevert",
                    args: [userOp]
                }),
                gas: gasCap,
                stateOverride
            })
        } catch (err) {
            if (isEstimateGasRevert(err)) {
                return undefined
            }
            throw err
        }
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
