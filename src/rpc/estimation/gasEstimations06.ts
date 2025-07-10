import type { StateOverrides, UserOperationV06 } from "@alto/types"
import { type Logger, deepHexlify } from "@alto/utils"
import type { Hex } from "viem"
import { type Address, getContract } from "viem"
import { entryPoint06Abi } from "viem/account-abstraction"
import entryPointOverride from "../../contracts/EntryPointGasEstimationOverride.sol/EntryPointGasEstimationOverride06.json" with {
    type: "json"
}
import type { AltoConfig } from "../../createConfig"
import { getSenderCreatorOverride } from "../../utils/entryPointOverrides"
import type { SimulateHandleOpResult } from "./types"
import {
    decodeSimulateHandleOpError,
    prepareStateOverride,
    simulationErrors
} from "./utils"

export class GasEstimatorV06 {
    private config: AltoConfig
    private logger: Logger

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

    async simulateHandleOpV06({
        userOp,
        targetAddress,
        targetCallData,
        entryPoint,
        useCodeOverride = true,
        userStateOverrides = undefined
    }: {
        userOp: UserOperationV06
        targetAddress: Address
        targetCallData: Hex
        entryPoint: Address
        useCodeOverride?: boolean
        userStateOverrides?: StateOverrides | undefined
    }): Promise<SimulateHandleOpResult> {
        const {
            publicClient,
            //blockTagSupport,
            utilityWalletAddress,
            fixedGasLimitForEstimation,
            codeOverrideSupport
        } = this.config

        // EntryPoint simulation 06 code specific overrides
        if (codeOverrideSupport && useCodeOverride) {
            if (userStateOverrides === undefined) {
                userStateOverrides = {}
            }

            const senderCreatorOverride = getSenderCreatorOverride(entryPoint)

            userStateOverrides[entryPoint] = {
                ...deepHexlify(userStateOverrides?.[entryPoint] || {}),
                stateDiff: {
                    ...(userStateOverrides[entryPoint]?.stateDiff || {}),
                    [senderCreatorOverride.slot]: senderCreatorOverride.value
                },
                code: entryPointOverride.deployedBytecode.object as Hex
            }
        }

        const viemStateOverride = prepareStateOverride({
            userOps: [userOp],
            queuedUserOps: [], // Queued operations are not supported for EntryPoint v0.6
            stateOverrides: userStateOverrides,
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
            const decodedError = decodeSimulateHandleOpError(e, this.logger)
            if (decodedError.result === "failed") {
                this.logger.warn(
                    { err: e, data: decodedError.data },
                    "Contract function reverted in simulateValidation"
                )
            }
            return decodedError
        }
    }
}
