import type { StateOverrides, UserOperationV06 } from "@alto/types"
import type { Hex } from "viem"
import { type Address, getContract } from "viem"
import type { SimulateHandleOpResult } from "./types"
import type { AltoConfig } from "../../createConfig"
import {
    prepareStateOverride,
    decodeSimulateHandleOpError,
    simulationErrors
} from "./utils"
import { deepHexlify, type Logger } from "@alto/utils"
import { getSenderCreatorOverride } from "../../utils/entryPointOverrides"
import entryPointOverride from "../../contracts/EntryPointGasEstimationOverride.sol/EntryPointGasEstimationOverride06.json" with {
    type: "json"
}
import { entryPoint06Abi } from "viem/account-abstraction"

export class GasEstimator06 {
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

    async simulateHandleOp06({
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
