import type { StateOverrides, UserOperation06 } from "@alto/types"
import type { Logger } from "@alto/utils"
import {
    type Abi,
    type Address,
    encodeFunctionData,
    getContract,
    zeroAddress
} from "viem"
import { entryPoint06Abi } from "viem/account-abstraction"
import entryPointOverride from "../../contracts/EntryPointGasEstimationOverride.sol/EntryPointGasEstimationOverride06.json" with {
    type: "json"
}
import type { AltoConfig } from "../../createConfig"
import { TX_MAX_GAS_LIMIT, getReservoirGas } from "../../utils/eip8037"
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

    // Smallest EIP-8037 state gas reservoir the userOp passes with, with the
    // call phase capped at callGasLimit, or undefined if maxReservoirGas isn't
    // enough
    async findReservoirGas06({
        userOp,
        entryPoint,
        userStateOverrides,
        maxReservoirGas
    }: {
        userOp: UserOperation06
        entryPoint: Address
        userStateOverrides?: StateOverrides
        maxReservoirGas: bigint
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
            const gas = await this.config.publicClient.estimateGas({
                account: this.config.utilityWalletAddress,
                to: entryPoint,
                data: encodeFunctionData({
                    abi: entryPointOverride.abi as Abi,
                    functionName: "simulateHandleOpNoRevert",
                    args: [userOp]
                }),
                gas: TX_MAX_GAS_LIMIT + maxReservoirGas,
                stateOverride
            })
            return getReservoirGas(gas)
        } catch (err) {
            if (isEstimateGasRevert(err)) {
                return undefined
            }
            throw err
        }
    }

    async simulateHandleOp06({
        userOp,
        entryPoint,
        useCodeOverride = true,
        userStateOverrides = undefined,
        simulationGasLimit
    }: {
        userOp: UserOperation06
        entryPoint: Address
        useCodeOverride?: boolean
        userStateOverrides?: StateOverrides
        // Undefined uses the node's default
        simulationGasLimit: bigint | undefined
    }): Promise<SimulateHandleOpResult> {
        const {
            publicClient,
            //blockTagSupport,
            utilityWalletAddress
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
                [userOp, zeroAddress, "0x"],
                {
                    account: utilityWalletAddress,
                    gas: simulationGasLimit,
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
