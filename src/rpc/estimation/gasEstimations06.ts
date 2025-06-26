import {
    EntryPointV06Abi,
    EntryPointV06SimulationsAbi,
    ValidationErrors,
    executionResultSchema
} from "@alto/types"
import type { StateOverrides, UserOperationV06 } from "@alto/types"
import type { Hex } from "viem"
import { type Address, decodeErrorResult, encodeFunctionData } from "viem"
import type { SimulateHandleOpResult } from "./types"
import type { AltoConfig } from "../../createConfig"
import {
    parseFailedOpWithRevert,
    prepareStateOverride,
    decodeSimulateHandleOpError
} from "./utils"
import { deepHexlify, type Logger } from "@alto/utils"
import entryPointOverride from "../../contracts/EntryPointGasEstimationOverride.sol/EntryPointGasEstimationOverride06.json" with {
    type: "json"
}
import { getSenderCreatorOverride } from "../../utils/entryPointOverrides"

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

    decodeSimulateHandleOpResult(data: Hex): SimulateHandleOpResult {
        if (data === "0x") {
            return {
                result: "failed",
                data: "AA23 reverted: UserOperation called non-existant contract, or reverted with 0x",
                code: ValidationErrors.SimulateValidation
            }
        }

        const decodedError = decodeErrorResult({
            abi: [...EntryPointV06Abi, ...EntryPointV06SimulationsAbi],
            data
        })

        if (
            decodedError &&
            decodedError.errorName === "FailedOp" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: decodedError.args[1] as string,
                code: ValidationErrors.SimulateValidation
            } as const
        }

        // custom error thrown by entryPoint if code override is used
        if (
            decodedError &&
            decodedError.errorName === "CallPhaseReverted" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: decodedError.args[0],
                code: ValidationErrors.SimulateValidation
            } as const
        }

        // custom error thrown by entryPoint if code override is used
        if (
            decodedError &&
            decodedError.errorName === "FailedOpWithRevert" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: `${decodedError.args?.[1]} ${parseFailedOpWithRevert(
                    decodedError.args?.[2] as Hex
                )}`,
                code: ValidationErrors.SimulateValidation
            } as const
        }

        if (
            decodedError &&
            decodedError.errorName === "Error" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: decodedError.args[0],
                code: ValidationErrors.SimulateValidation
            } as const
        }

        if (decodedError.errorName === "ExecutionResult") {
            const parsedExecutionResult = executionResultSchema.parse(
                decodedError.args
            )

            return {
                result: "execution",
                data: {
                    executionResult: parsedExecutionResult
                } as const
            }
        }

        throw new Error(
            "Unexpected error whilst decoding simulateHandleOp result"
        )
    }

    async simulateHandleOpV06({
        userOperation,
        targetAddress,
        targetCallData,
        entryPoint,
        useCodeOverride = true,
        userStateOverrides = undefined
    }: {
        userOperation: UserOperationV06
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
            userOperations: [userOperation],
            queuedUserOperations: [], // Queued operations are not supported for EntryPoint v0.6
            stateOverrides: userStateOverrides,
            config: this.config
        })

        try {
            await publicClient.call({
                account: utilityWalletAddress,
                to: entryPoint,
                data: encodeFunctionData({
                    abi: EntryPointV06Abi,
                    functionName: "simulateHandleOp",
                    args: [userOperation, targetAddress, targetCallData]
                }),
                gas: fixedGasLimitForEstimation,
                stateOverride: viemStateOverride
            })
        } catch (e) {
            const decodedError = decodeSimulateHandleOpError(e, this.logger)
            this.logger.warn(
                { err: e, data: decodedError.data },
                "Contract function reverted in simulateValidation"
            )
            return decodedError
        }
        throw new Error("Unexpected error")
    }
}
